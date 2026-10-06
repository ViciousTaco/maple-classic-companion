//! Global hotkey → `mcc://watch-toggle` to every window (I-29: one-key on/off for the screen watcher).
//! Default Ctrl+Shift+K; the owner can pick another (I-33). Only *receives* a hotkey (RegisterHotKey); never
//! sends input anywhere.
use std::sync::Mutex;
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT_ACCELERATOR: &str = "Ctrl+Shift+K";
pub const WATCH_TOGGLE_EVENT: &str = "mcc://watch-toggle";

struct Current {
    accelerator: String,
    shortcut: Option<Shortcut>,
    registered: bool,
}

static CURRENT: Mutex<Current> = Mutex::new(Current { accelerator: String::new(), shortcut: None, registered: false });

/// "Ctrl+Shift+K" → a shortcut. Needs at least one modifier and exactly one key, so a bare letter can never be
/// swallowed from every app on the PC.
pub fn parse(accelerator: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        return Err("Use at least one of Ctrl, Alt, Shift plus a key, e.g. Ctrl+Shift+K".into());
    }
    let (key, mods) = parts.split_last().unwrap();
    let mut spec = String::new();
    for m in mods {
        let m = match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "ctrl",
            "alt" => "alt",
            "shift" => "shift",
            "win" | "super" | "meta" => "super",
            other => return Err(format!("Unknown modifier “{other}”")),
        };
        spec.push_str(m);
        spec.push('+');
    }
    let code = match key.len() {
        1 if key.chars().all(|c| c.is_ascii_alphabetic()) => format!("Key{}", key.to_ascii_uppercase()),
        1 if key.chars().all(|c| c.is_ascii_digit()) => format!("Digit{key}"),
        _ if key.len() <= 3 && key.to_ascii_uppercase().starts_with('F') && key[1..].chars().all(|c| c.is_ascii_digit()) => key.to_ascii_uppercase(),
        _ => return Err(format!("Use a letter, digit or F-key as the last part (got “{key}”)")),
    };
    spec.push_str(&code);
    spec.parse::<Shortcut>().map_err(|e| format!("Can't use “{accelerator}”: {e}"))
}

/// The plugin with our handler; the shortcut itself is registered in `set` so a clash can't stop startup.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let current = CURRENT.lock().map(|c| c.shortcut.map(|s| s.id())).unwrap_or(None);
            if event.state() == ShortcutState::Pressed && Some(shortcut.id()) == current {
                let _ = app.emit(WATCH_TOGGLE_EVENT, ());
            }
        })
        .build()
}

/// Registers `accelerator` (unregistering the previous one). If another app owns it, keep running and report it.
pub fn set<R: Runtime>(app: &AppHandle<R>, accelerator: &str) -> Result<HotkeyStatus, String> {
    let shortcut = parse(accelerator)?;
    let mut cur = CURRENT.lock().map_err(|_| "hotkey state poisoned".to_string())?;
    if let Some(old) = cur.shortcut.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    cur.accelerator = accelerator.to_string();
    cur.shortcut = Some(shortcut);
    cur.registered = match app.global_shortcut().register(shortcut) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("{accelerator} is not available: {err}");
            false
        }
    };
    Ok(HotkeyStatus { registered: cur.registered, accelerator: cur.accelerator.clone() })
}

/// Call once from `setup` (main thread).
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let _ = set(app, DEFAULT_ACCELERATOR);
}

#[derive(serde::Serialize, Clone)]
pub struct HotkeyStatus {
    registered: bool,
    accelerator: String,
}

#[tauri::command]
pub fn hotkey_status() -> HotkeyStatus {
    let cur = CURRENT.lock().expect("hotkey state");
    HotkeyStatus {
        registered: cur.registered,
        accelerator: if cur.accelerator.is_empty() { DEFAULT_ACCELERATOR.to_string() } else { cur.accelerator.clone() },
    }
}

/// I-33: the owner's choice, applied immediately (the UI keeps it in settings and re-applies it at startup).
#[tauri::command]
pub fn hotkey_set(app: AppHandle, accelerator: String) -> Result<HotkeyStatus, String> {
    set(&app, &accelerator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_ctrl_shift_k() {
        let parsed: Shortcut = "ctrl+shift+KeyK".parse().unwrap();
        assert_eq!(parse(DEFAULT_ACCELERATOR).unwrap().id(), parsed.id());
    }

    #[test]
    fn accepts_owner_choices_and_rejects_unsafe_ones() {
        assert!(parse("Ctrl+Alt+W").is_ok());
        assert!(parse("Alt+F9").is_ok());
        assert!(parse("ctrl + shift + 7").is_ok());
        assert!(parse("K").is_err(), "a bare key would steal it from every app");
        assert!(parse("Ctrl+Enter").is_err());
        assert!(parse("Hyper+K").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn status_before_registration_reports_the_default() {
        let s = hotkey_status();
        assert_eq!(s.accelerator, DEFAULT_ACCELERATOR);
    }
}
