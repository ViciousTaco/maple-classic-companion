mod cache;
mod datapack;
mod files;
mod paths;
mod screenshots;
pub mod signing;
pub mod storage;
mod updater;

use paths::AppPaths;
use storage::{BackupInfo, LoadResult, ProfileStore, WindowGeometry};
use screenshots::ImageSlot;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    paths: AppPaths,
    profiles: ProfileStore,
}

#[tauri::command]
fn get_paths(state: State<'_, AppState>) -> AppPaths {
    state.paths.clone()
}

#[tauri::command]
fn profiles_load(state: State<'_, AppState>) -> Result<LoadResult, String> {
    state.profiles.load()
}

#[tauri::command]
fn profiles_save(state: State<'_, AppState>, json: String) -> Result<(), String> {
    state.profiles.save(&json)
}

#[tauri::command]
fn backups_list(state: State<'_, AppState>) -> Vec<BackupInfo> {
    storage::list_backups(&state.profiles.backup_dir)
}

#[tauri::command]
fn backups_restore(state: State<'_, AppState>, file: String) -> Result<String, String> {
    state.profiles.read_backup(&file)
}

#[derive(serde::Serialize)]
struct SavedFile {
    file: String,
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("Expected raw image bytes".into()),
    }
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing header {name}"))
}

/// Empty response = no image.
fn image_response(slot: &ImageSlot) -> Response {
    Response::new(slot.read().unwrap_or_default())
}

#[tauri::command]
fn screenshot_save(state: State<'_, AppState>, request: Request<'_>) -> Result<SavedFile, String> {
    let slot = ImageSlot::screenshot(&state.paths.data_dir, &header(&request, "x-profile-id")?)?;
    Ok(SavedFile { file: slot.save(raw_body(&request)?)? })
}

#[tauri::command]
fn screenshot_read(state: State<'_, AppState>, profile_id: String) -> Result<Response, String> {
    Ok(image_response(&ImageSlot::screenshot(&state.paths.data_dir, &profile_id)?))
}

#[tauri::command]
fn screenshot_delete(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    ImageSlot::screenshot(&state.paths.data_dir, &profile_id)?.delete()
}

#[tauri::command]
fn entity_image_save(state: State<'_, AppState>, request: Request<'_>) -> Result<SavedFile, String> {
    let slot =
        ImageSlot::entity(&state.paths.data_dir, &header(&request, "x-kind")?, &header(&request, "x-id")?)?;
    Ok(SavedFile { file: slot.save(raw_body(&request)?)? })
}

#[tauri::command]
fn entity_image_read(state: State<'_, AppState>, kind: String, id: String) -> Result<Response, String> {
    Ok(image_response(&ImageSlot::entity(&state.paths.data_dir, &kind, &id)?))
}

#[tauri::command]
fn entity_image_delete(state: State<'_, AppState>, kind: String, id: String) -> Result<(), String> {
    ImageSlot::entity(&state.paths.data_dir, &kind, &id)?.delete()
}

#[tauri::command]
fn image_cache_save(state: State<'_, AppState>, request: Request<'_>) -> Result<SavedFile, String> {
    let slot =
        ImageSlot::cached(&state.paths.data_dir, &header(&request, "x-kind")?, &header(&request, "x-id")?)?;
    Ok(SavedFile { file: slot.save(raw_body(&request)?)? })
}

#[tauri::command]
fn image_cache_read(state: State<'_, AppState>, kind: String, id: String) -> Result<Response, String> {
    Ok(image_response(&ImageSlot::cached(&state.paths.data_dir, &kind, &id)?))
}

#[tauri::command]
fn profiles_backup_now(state: State<'_, AppState>) -> Result<(), String> {
    state.profiles.backup_now()
}

#[tauri::command]
fn export_save(state: State<'_, AppState>, file_name: String, json: String) -> Result<String, String> {
    files::export_save(&state.paths.data_dir, &file_name, &json)
}

#[tauri::command]
fn reveal_folder(app: AppHandle, state: State<'_, AppState>, which: String) -> Result<(), String> {
    let dir = files::named_folder(&state.paths.data_dir, &which)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn field_note_create(state: State<'_, AppState>, json: String) -> Result<String, String> {
    files::field_note_create(&state.paths.data_dir, &json)
}

#[tauri::command]
fn field_note_add_image(state: State<'_, AppState>, request: Request<'_>) -> Result<SavedFile, String> {
    let id = header(&request, "x-note-id")?;
    Ok(SavedFile { file: files::field_note_add_image(&state.paths.data_dir, &id, raw_body(&request)?)? })
}

/// Restores the saved size/position; skips the position if it is no longer on any monitor.
fn apply_geometry(w: &WebviewWindow, g: WindowGeometry) {
    let _ = w.set_size(LogicalSize::new(g.width, g.height));
    let on_screen = w.available_monitors().unwrap_or_default().iter().any(|m| {
        let s = m.scale_factor();
        let (px, py) = (m.position().x as f64 / s, m.position().y as f64 / s);
        let (pw, ph) = (m.size().width as f64 / s, m.size().height as f64 / s);
        g.x + 100.0 > px && g.x < px + pw - 100.0 && g.y >= py - 10.0 && g.y < py + ph - 100.0
    });
    if on_screen {
        let _ = w.set_position(LogicalPosition::new(g.x, g.y));
    } else {
        let _ = w.center();
    }
    if g.maximized {
        let _ = w.maximize();
    }
}

/// Native error box for failures before any window exists.
#[cfg(windows)]
fn fatal(message: &str) {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    let (text, caption) = (wide(message), wide("Maple Classic Companion"));
    // SAFETY: both buffers are NUL-terminated UTF-16 that outlive the call; MB_ICONERROR = 0x10.
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10) };
}

#[cfg(not(windows))]
fn fatal(message: &str) {
    eprintln!("{message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // After a self-update relaunch, let the old process exit before the single-instance check.
    updater::wait_for_previous_instance();
    let paths = match paths::resolve_from_env() {
        Ok(p) => p,
        Err(err) => return fatal(&format!("Maple Classic Companion can't start: {err}")),
    };
    let webview_dir = paths.data_dir.join("webview");
    // Belt and braces: the window below also passes this folder explicitly.
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);

    if tauri::webview_version().is_err() {
        return fatal(
            "Microsoft Edge WebView2 is required but was not found.\n\n\
             Install the \"Evergreen Bootstrapper\" from\n\
             https://developer.microsoft.com/microsoft-edge/webview2/\n\
             then start Maple Classic Companion again.",
        );
    }

    let state = AppState { profiles: ProfileStore::new(&paths.data_dir), paths };
    let geometry = state.profiles.saved_window();

    tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window (single writer).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(state)
        .setup(move |app| {
            // Created here (not in tauri.conf.json) so WebView2 data lives in the portable folder.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Maple Classic Companion")
                .inner_size(1280.0, 800.0)
                .min_inner_size(1024.0, 640.0)
                .data_directory(webview_dir.clone())
                .visible(false)
                .build()?;
            if let Some(g) = geometry {
                apply_geometry(&window, g);
            }
            window.show()?;
            // A successful start: the previous version's leftovers can go (P8-T6).
            std::thread::spawn(updater::cleanup_update_leftovers);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_paths,
            profiles_load,
            profiles_save,
            backups_list,
            backups_restore,
            screenshot_save,
            screenshot_read,
            screenshot_delete,
            entity_image_save,
            entity_image_read,
            entity_image_delete,
            image_cache_save,
            image_cache_read,
            profiles_backup_now,
            export_save,
            reveal_folder,
            field_note_create,
            field_note_add_image,
            datapack::pack_active,
            datapack::pack_read,
            datapack::pack_verify_manifest,
            datapack::pack_install,
            datapack::pack_rollback,
            updater::app_update_apply,
            updater::app_version,
            cache::cache_read,
            cache::cache_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
