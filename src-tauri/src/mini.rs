//! Mini window (I-24): a small always-on-top second window running the same UI bundle; the frontend renders the
//! mini UI when `getCurrentWindow().label === "mini"`. It never writes profiles itself (single writer, §8.2):
//! it relays actions to `main` with `relay_to_main`, and reloads when `main` emits `mcc://profiles-saved`.
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_LABEL: &str = "main";
pub const MINI_LABEL: &str = "mini";
pub const MINI_ACTION_EVENT: &str = "mcc://mini-action";
pub const PROFILES_SAVED_EVENT: &str = "mcc://profiles-saved";

/// Opens the mini window, or brings it back if it already exists.
pub fn open<R: Runtime>(app: &AppHandle<R>, webview_dir: PathBuf) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::default())
        .title("Maple Classic Companion — mini")
        .inner_size(360.0, 520.0)
        .min_inner_size(280.0, 320.0)
        .resizable(true)
        .maximizable(false)
        .always_on_top(true)
        // Same portable WebView2 folder as the main window: nothing lands in %LOCALAPPDATA%.
        .data_directory(webview_dir)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn close<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    match app.get_webview_window(MINI_LABEL) {
        Some(w) => w.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// `^[a-z0-9][a-z0-9:._-]{0,63}$`
pub fn is_action_kind(kind: &str) -> bool {
    let b = kind.as_bytes();
    (1..=64).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && !b[0].is_ascii_uppercase()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b':' | b'.' | b'_' | b'-'))
}

#[derive(Clone, serde::Serialize)]
pub struct MiniAction {
    pub kind: String,
    pub payload: serde_json::Value,
}

/// Emits `mcc://mini-action` `{ kind, payload }` to the main window only.
pub fn relay<R: Runtime>(app: &AppHandle<R>, kind: String, payload: Option<serde_json::Value>) -> Result<(), String> {
    if !is_action_kind(&kind) {
        return Err("kind must match ^[a-z0-9][a-z0-9:._-]{0,63}$".into());
    }
    let target = EventTarget::WebviewWindow { label: MAIN_LABEL.into() };
    app.emit_to(target, MINI_ACTION_EVENT, MiniAction { kind, payload: payload.unwrap_or_default() })
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_kinds_are_simple_names() {
        for ok in ["backup-now", "route:next", "quest.toggle", "a", "x_1"] {
            assert!(is_action_kind(ok), "{ok}");
        }
        for bad in ["", "Backup", "-x", "a b", "a/b", &"x".repeat(65)] {
            assert!(!is_action_kind(bad), "{bad}");
        }
    }
}
