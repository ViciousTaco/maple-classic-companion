//! Event reminders (I-26): Windows toast when it can actually appear, otherwise a taskbar flash plus an in-app
//! banner event (`mcc://notify`) that every window can show.
//!
//! Why a fallback: a Windows 10 toast needs a *registered* AppUserModelID (Start-menu shortcut or
//! `HKCU\Software\Classes\AppUserModelId\<id>`). tauri-plugin-notification uses the app identifier as the id
//! when the exe runs anywhere except `target\debug|release` (where it borrows PowerShell's id). The portable exe
//! registers nothing (no shortcut, no registry writes), so Windows drops its toasts silently. Toasts are also
//! dropped when the owner has switched Windows notifications off. We only *read* those settings here.
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, UserAttentionType};
use tauri_plugin_notification::NotificationExt;

pub const BANNER_EVENT: &str = "mcc://notify";
/// The id tauri-plugin-notification (via tauri-winrt-notification) uses for exes inside `target\debug|release`.
const POWERSHELL_APP_ID: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NotifyStatus {
    /// `true` → `notify_show` uses a Windows toast.
    pub toast: bool,
    /// Why toasts are not used (shown to the owner), else `null`.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotifyResult {
    /// `"toast"` or `"fallback"` (taskbar flash + `mcc://notify` banner event).
    pub via: &'static str,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct Banner<'a> {
    title: &'a str,
    body: &'a str,
}

fn check_text(title: &str, body: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("Notification title must be 1-200 characters".into());
    }
    if body.chars().count() > 1000 {
        return Err("Notification text is too long (max 1000 characters)".into());
    }
    Ok(())
}

/// The AppUserModelID the plugin will stamp on the toast for an exe in `exe_dir`.
pub fn plugin_app_id(exe_dir: &std::path::Path, identifier: &str) -> String {
    let dir = exe_dir.to_string_lossy();
    let dev = [r"\target\debug", r"\target\release", "/target/debug", "/target/release"]
        .iter()
        .any(|suffix| dir.ends_with(suffix));
    if dev {
        POWERSHELL_APP_ID.to_string()
    } else {
        identifier.to_string()
    }
}

#[cfg(windows)]
mod settings {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{
                RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
                RRF_RT_REG_DWORD,
            },
        },
    };

    pub fn dword(root: HKEY, key: &str, value: &str) -> Option<u32> {
        let mut data = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        // SAFETY: out-pointers sized for a DWORD; read-only registry query.
        let status = unsafe {
            RegGetValueW(
                root,
                &HSTRING::from(key),
                &HSTRING::from(value),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut data as *mut u32 as *mut core::ffi::c_void),
                Some(&mut size),
            )
        };
        (status == ERROR_SUCCESS).then_some(data)
    }

    pub fn key_exists(root: HKEY, key: &str) -> bool {
        let mut h = HKEY::default();
        // SAFETY: read-only open; the handle is closed straight away.
        unsafe {
            let ok = RegOpenKeyExW(root, &HSTRING::from(key), None, KEY_READ, &mut h) == ERROR_SUCCESS;
            if ok {
                let _ = RegCloseKey(h);
            }
            ok
        }
    }

    /// `None` = a toast for `app_id` can appear; otherwise the reason it can't.
    pub fn toast_blocker(app_id: &str) -> Option<String> {
        if dword(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\PushNotifications", "ToastEnabled")
            == Some(0)
        {
            return Some("Windows notifications are turned off (Settings > System > Notifications)".into());
        }
        let per_app = format!(r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{app_id}");
        if dword(HKEY_CURRENT_USER, &per_app, "Enabled") == Some(0) {
            return Some("Notifications for this app are turned off in Windows Settings".into());
        }
        if app_id != super::POWERSHELL_APP_ID {
            let registered = format!(r"Software\Classes\AppUserModelId\{app_id}");
            if !key_exists(HKEY_CURRENT_USER, &registered) && !key_exists(HKEY_LOCAL_MACHINE, &registered) {
                return Some("Windows only shows pop-up notifications for installed apps".into());
            }
        }
        None
    }
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> NotifyStatus {
    #[cfg(windows)]
    {
        let exe_dir = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_default();
        let blocker = settings::toast_blocker(&plugin_app_id(&exe_dir, &app.config().identifier));
        NotifyStatus { toast: blocker.is_none(), reason: blocker }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        NotifyStatus { toast: true, reason: None }
    }
}

/// Flashes every window's taskbar button (until it is focused) and asks the UI to show a banner.
pub fn fallback<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) -> Result<(), String> {
    for w in app.webview_windows().values() {
        let _ = w.request_user_attention(Some(UserAttentionType::Informational));
    }
    app.emit(BANNER_EVENT, Banner { title, body }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_status(app: AppHandle) -> NotifyStatus {
    status(&app)
}

#[tauri::command]
pub fn notify_show(app: AppHandle, title: String, body: String) -> Result<NotifyResult, String> {
    check_text(&title, &body)?;
    let s = status(&app);
    if s.toast {
        let shown = app.notification().builder().title(&title).body(&body).show();
        if shown.is_ok() {
            return Ok(NotifyResult { via: "toast", reason: None });
        }
    }
    fallback(&app, &title, &body)?;
    Ok(NotifyResult { via: "fallback", reason: s.reason })
}

#[tauri::command]
pub fn notify_fallback(app: AppHandle, title: String, body: String) -> Result<(), String> {
    check_text(&title, &body)?;
    fallback(&app, &title, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn plugin_app_id_matches_the_plugin_rule() {
        let id = "com.vicioustaco.mapleclassiccompanion";
        assert_eq!(plugin_app_id(Path::new(r"E:\x\src-tauri\target\release"), id), POWERSHELL_APP_ID);
        assert_eq!(plugin_app_id(Path::new(r"E:\x\src-tauri\target\debug"), id), POWERSHELL_APP_ID);
        assert_eq!(plugin_app_id(Path::new(r"E:\Games\Maple Classic Companion"), id), id);
        assert_eq!(plugin_app_id(Path::new(r"E:\x\test-run"), id), id);
    }

    #[test]
    fn notification_text_is_bounded() {
        assert!(check_text("Event in 15 min", "Gold Rush starts 8:00 pm").is_ok());
        assert!(check_text(" ", "").is_err());
        assert!(check_text(&"t".repeat(201), "").is_err());
        assert!(check_text("t", &"b".repeat(1001)).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn unregistered_portable_id_is_blocked() {
        let reason = settings::toast_blocker("com.vicioustaco.mapleclassiccompanion.never-registered-test-id");
        assert!(reason.is_some());
    }
}
