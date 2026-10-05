//! App self-update (P8-T6): download → verify sha256 + minisign → self-replace → relaunch.
//! Only ever runs after the user clicks; the URL must be one of this project's GitHub release assets.
use crate::signing;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::AppHandle;

pub const RELEASE_URL_PREFIX: &str =
    "https://github.com/ViciousTaco/maple-classic-companion/releases/download/";
/// `<exe> --mcc-relaunch-after <pid>`: the relaunched app waits for the old process to exit first,
/// so the single-instance check doesn't hand control back to the instance that is closing.
const RELAUNCH_ARG: &str = "--mcc-relaunch-after";
const MAX_DOWNLOAD_BYTES: usize = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// Name suffixes `self_replace` gives its temporary copies (`.<stem>.<random><suffix>`).
const SELF_REPLACE_SUFFIXES: [&str; 3] = [".__relocated__.exe", ".__selfdelete__.exe", ".__temp__.exe"];

fn e<T: std::fmt::Display>(x: T) -> String {
    x.to_string()
}

/// Allows only `RELEASE_URL_PREFIX` + `<tag>/<file>`, each segment `[A-Za-z0-9._-]+` without a leading dot
/// (so no `..`, query, fragment, percent-escapes or backslashes can steer the request elsewhere).
pub fn check_url(url: &str) -> Result<(), String> {
    let rest =
        url.strip_prefix(RELEASE_URL_PREFIX).ok_or("Update URL is not an official release download")?;
    let segments: Vec<&str> = rest.split('/').collect();
    let ok = url.len() <= 512
        && segments.len() == 2
        && segments.iter().all(|s| {
            !s.is_empty()
                && !s.starts_with('.')
                && !s.contains("..")
                && s.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
        });
    if ok {
        Ok(())
    } else {
        Err("Update URL is not an official release download".into())
    }
}

/// The downloaded file must match both the published sha256 (hex, any case) and the release signature.
pub fn verify_update(
    bytes: &[u8],
    sha256_hex: &str,
    signature_b64: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let want = sha256_hex.trim();
    if want.len() != 64 || !want.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("sha256 must be 64 hex characters".into());
    }
    if !signing::sha256_hex(bytes).eq_ignore_ascii_case(want) {
        return Err("The downloaded update is damaged (sha256 does not match)".into());
    }
    signing::verify(bytes, signature_b64, public_key_b64)
        .map_err(|x| format!("Update signature rejected: {x}"))
}

/// `<exe>.new` — the download lands beside the running exe (same volume, so the swap is a rename).
fn new_path(exe: &Path) -> PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(".new");
    PathBuf::from(name)
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    use tauri_plugin_http::reqwest;
    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(10)) // github.com → *.githubusercontent.com
        .https_only(true)
        .user_agent(concat!("MapleClassicCompanion/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(e)?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|x| format!("Download failed: {x}"))?;
    if resp.content_length().is_some_and(|n| n > MAX_DOWNLOAD_BYTES as u64) {
        return Err("Update file is unexpectedly large".into());
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|x| format!("Download failed: {x}"))? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_DOWNLOAD_BYTES {
            return Err("Update file is unexpectedly large".into());
        }
    }
    Ok(buf)
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(e)?;
    f.write_all(bytes).map_err(e)?;
    f.sync_all().map_err(e)
}

/// §8.3 `app_update_apply`: on success the app relaunches and this never returns to the UI.
/// The UI must flush unsaved changes before calling it.
#[tauri::command]
pub async fn app_update_apply(
    app: AppHandle,
    url: String,
    sha256: String,
    signature: String,
) -> Result<(), String> {
    check_url(&url)?;
    if cfg!(debug_assertions) {
        return Err("Self-update is disabled in development builds".into());
    }
    let exe = std::env::current_exe().map_err(e)?;
    let new_exe = new_path(&exe);
    let bytes = download(&url).await?;
    write_synced(&new_exe, &bytes).map_err(|x| format!("Can't save the update beside the app: {x}"))?;
    let on_disk = fs::read(&new_exe).map_err(e)?;
    if let Err(err) = verify_update(&on_disk, &sha256, &signature, signing::UPDATE_PUBLIC_KEY) {
        let _ = fs::remove_file(&new_exe);
        return Err(err);
    }
    let replaced = self_replace::self_replace(&new_exe);
    let _ = fs::remove_file(&new_exe);
    replaced.map_err(|x| format!("Can't replace the app: {x}"))?;
    let mut relaunch = std::process::Command::new(&exe);
    relaunch.arg(RELAUNCH_ARG).arg(std::process::id().to_string());
    if let Some(dir) = exe.parent() {
        relaunch.current_dir(dir);
    }
    relaunch
        .spawn()
        .map_err(|x| format!("Updated, but couldn't restart ({x}). Please start the app again."))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Call first thing in `run()`: after a self-update relaunch, wait (≤ 30 s) for the old process to exit.
pub fn wait_for_previous_instance() {
    let args: Vec<String> = std::env::args().collect();
    let Some(i) = args.iter().position(|a| a == RELAUNCH_ARG) else {
        return;
    };
    if let Some(pid) = args.get(i + 1).and_then(|p| p.parse::<u32>().ok()) {
        wait_for_exit(pid, Duration::from_secs(30));
    }
}

#[cfg(windows)]
fn wait_for_exit(pid: u32, timeout: Duration) {
    use core::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn WaitForSingleObject(handle: *mut c_void, millis: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const SYNCHRONIZE: u32 = 0x0010_0000;
    // SAFETY: plain Win32 calls; the handle is checked for null and closed exactly once.
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return; // already gone
        }
        WaitForSingleObject(handle, timeout.as_millis().min(u32::MAX as u128) as u32);
        CloseHandle(handle);
    }
}

#[cfg(not(windows))]
fn wait_for_exit(_pid: u32, _timeout: Duration) {
    std::thread::sleep(Duration::from_secs(1));
}

/// Files a previous update can leave in `dir`: `<exe>.new`, `<exe>.old` and self-replace's temporary
/// `.<stem>.<random>.__relocated__.exe` / `__selfdelete__` / `__temp__` copies.
pub fn update_leftovers(dir: &Path, exe: &Path) -> Vec<PathBuf> {
    let (Some(name), Some(stem)) =
        (exe.file_name().and_then(|x| x.to_str()), exe.file_stem().and_then(|x| x.to_str()))
    else {
        return vec![];
    };
    let (new, old, prefix) = (format!("{name}.new"), format!("{name}.old"), format!(".{stem}."));
    let Ok(rd) = fs::read_dir(dir) else {
        return vec![];
    };
    rd.filter_map(|x| x.ok())
        .filter(|x| x.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|x| x.file_name().into_string().ok())
        .filter(|n| {
            n.eq_ignore_ascii_case(&new)
                || n.eq_ignore_ascii_case(&old)
                || (n.starts_with(&prefix) && SELF_REPLACE_SUFFIXES.iter().any(|s| n.ends_with(s)))
        })
        .map(|n| dir.join(n))
        .collect()
}

/// Best effort, after a successful start: removes update leftovers beside the exe and in %TEMP%
/// (where self-replace may park the old exe). Files still in use are skipped.
pub fn cleanup_update_leftovers() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut dirs = vec![std::env::temp_dir()];
    if let Some(dir) = exe.parent() {
        dirs.insert(0, dir.to_path_buf());
    }
    for dir in dirs {
        for file in update_leftovers(&dir, &exe) {
            let _ = fs::remove_file(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DATA: &[u8] = include_bytes!("../tests/fixtures/signed.json");
    const SIG: &str = include_str!("../tests/fixtures/signed.json.sig");
    const KEY: &str = include_str!("../tests/fixtures/test.pub");

    #[test]
    fn updater_url_allow_list() {
        let good = format!("{RELEASE_URL_PREFIX}v0.2.0/MapleClassicCompanion.exe");
        assert!(check_url(&good).is_ok());
        for bad in [
            "http://github.com/ViciousTaco/maple-classic-companion/releases/download/v0.2.0/MapleClassicCompanion.exe",
            "https://github.com/ViciousTaco/other-repo/releases/download/v0.2.0/x.exe",
            "https://github.com.evil.example/ViciousTaco/maple-classic-companion/releases/download/v0.2.0/x.exe",
            "https://evil.example/https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v0.2.0/",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/../../../evil/repo/x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/%2e%2e/x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/x.exe?u=https://evil",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/x.exe#frag",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1\\..\\x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/a/x.exe",
            "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1/.x.exe",
            "",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn updater_accepts_matching_hash_and_signature() {
        let hash = signing::sha256_hex(DATA);
        verify_update(DATA, &hash, SIG, KEY).unwrap();
        verify_update(DATA, &hash.to_ascii_uppercase(), SIG, KEY).unwrap(); // case-insensitive
    }

    #[test]
    fn updater_rejects_hash_mismatch() {
        let wrong = signing::sha256_hex(b"something else");
        let err = verify_update(DATA, &wrong, SIG, KEY).unwrap_err();
        assert!(err.contains("sha256"), "{err}");
        assert!(verify_update(DATA, "abc", SIG, KEY).is_err());
        assert!(verify_update(DATA, &"z".repeat(64), SIG, KEY).is_err());
    }

    #[test]
    fn updater_rejects_bad_signature() {
        // Hash matches the (tampered) bytes, but the signature doesn't.
        let mut tampered = DATA.to_vec();
        tampered[5] ^= 1;
        let err = verify_update(&tampered, &signing::sha256_hex(&tampered), SIG, KEY).unwrap_err();
        assert!(err.contains("signature"), "{err}");
        // Signed by the test key, checked against the real release key.
        let hash = signing::sha256_hex(DATA);
        assert!(verify_update(DATA, &hash, SIG, signing::UPDATE_PUBLIC_KEY).is_err());
        assert!(verify_update(DATA, &hash, "", KEY).is_err());
    }

    #[test]
    fn updater_finds_only_its_own_leftovers() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("MapleClassicCompanion.exe");
        for name in [
            "MapleClassicCompanion.exe",
            "MapleClassicCompanion.exe.new",
            "MapleClassicCompanion.exe.old",
            ".MapleClassicCompanion.abcdefgh.__relocated__.exe",
            ".MapleClassicCompanion.abcdefgh.__selfdelete__.exe",
            ".MapleClassicCompanion.abcdefgh.__temp__.exe",
            ".Other.abcdefgh.__relocated__.exe",
            "MapleClassicCompanion-data.new",
            "notes.old",
        ] {
            fs::write(tmp.path().join(name), b"x").unwrap();
        }
        let mut found: Vec<String> = update_leftovers(tmp.path(), &exe)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        found.sort();
        assert_eq!(
            found,
            [
                ".MapleClassicCompanion.abcdefgh.__relocated__.exe",
                ".MapleClassicCompanion.abcdefgh.__selfdelete__.exe",
                ".MapleClassicCompanion.abcdefgh.__temp__.exe",
                "MapleClassicCompanion.exe.new",
                "MapleClassicCompanion.exe.old",
            ]
        );
        assert_eq!(new_path(&exe), tmp.path().join("MapleClassicCompanion.exe.new"));
    }
}
