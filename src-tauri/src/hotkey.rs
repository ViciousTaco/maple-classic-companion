//! Global hotkey Ctrl+Alt+W → `mcc://watch-toggle` to every window (I-29: one-key on/off for the screen watcher).
//! Only *receives* a hotkey (RegisterHotKey); never sends input anywhere.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const ACCELERATOR: &str = "Ctrl+Alt+W";
pub const WATCH_TOGGLE_EVENT: &str = "mcc://watch-toggle";

static REGISTERED: AtomicBool = AtomicBool::new(false);

fn watch_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyW)
}

/// The plugin with our handler; the shortcut itself is registered in `register` so a clash can't stop startup.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() == ShortcutState::Pressed && shortcut.id() == watch_shortcut().id() {
                let _ = app.emit(WATCH_TOGGLE_EVENT, ());
            }
        })
        .build()
}

/// Call once from `setup` (main thread). If another app already owns Ctrl+Alt+W, keep running and report it.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    match app.global_shortcut().register(watch_shortcut()) {
        Ok(()) => REGISTERED.store(true, Ordering::SeqCst),
        Err(err) => eprintln!("{ACCELERATOR} is not available: {err}"),
    }
}

#[derive(serde::Serialize)]
pub struct HotkeyStatus {
    registered: bool,
    accelerator: &'static str,
}

#[tauri::command]
pub fn hotkey_status() -> HotkeyStatus {
    HotkeyStatus { registered: REGISTERED.load(Ordering::SeqCst), accelerator: ACCELERATOR }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_is_ctrl_alt_w() {
        let parsed: Shortcut = "ctrl+alt+KeyW".parse().unwrap();
        assert_eq!(parsed.id(), watch_shortcut().id());
        assert_eq!(
            serde_json::to_string(&hotkey_status()).unwrap(),
            r#"{"registered":false,"accelerator":"Ctrl+Alt+W"}"#
        );
    }
}
