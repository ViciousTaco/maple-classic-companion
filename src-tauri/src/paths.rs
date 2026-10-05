//! Portable data directory resolution (plan §8.1).
use std::{
    env, fs,
    path::{Path, PathBuf},
};

pub const DATA_DIR_NAME: &str = "MapleClassicCompanion-data";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub portable: bool,
}

fn is_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Portable first (folder beside the exe); otherwise %LOCALAPPDATA%.
pub fn resolve(exe_dir: &Path, local_app_data: Option<&Path>) -> Result<AppPaths, String> {
    let portable = exe_dir.join(DATA_DIR_NAME);
    if is_writable(&portable) {
        return Ok(AppPaths { data_dir: portable, portable: true });
    }
    let base = local_app_data.ok_or("No writable location found for app data")?;
    let fallback = base.join("MapleClassicCompanion");
    if is_writable(&fallback) {
        return Ok(AppPaths { data_dir: fallback, portable: false });
    }
    Err("No writable location found for app data".into())
}

pub fn resolve_from_env() -> Result<AppPaths, String> {
    if let Some(over) = env::var_os("MCC_DATA_DIR") {
        // dev/test override
        let p = PathBuf::from(over);
        return if is_writable(&p) {
            Ok(AppPaths { data_dir: p, portable: false })
        } else {
            Err("MCC_DATA_DIR is not writable".into())
        };
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("exe has no parent directory")?;
    let lad = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    resolve(exe_dir, lad.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_portable_when_exe_dir_writable() {
        let tmp = tempfile::tempdir().unwrap();
        let got = resolve(tmp.path(), None).unwrap();
        assert!(got.portable);
        assert!(got.data_dir.is_dir());
        assert!(got.data_dir.ends_with(DATA_DIR_NAME));
    }

    #[test]
    fn paths_fallback_when_exe_dir_unwritable() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("not-a-dir");
        fs::write(&file, b"x").unwrap();
        let exe_dir = file.join("sub"); // create_dir_all fails under a file
        let lad = tmp.path().join("lad");
        let got = resolve(&exe_dir, Some(&lad)).unwrap();
        assert!(!got.portable);
        assert!(got.data_dir.ends_with("MapleClassicCompanion"));
    }

    #[test]
    fn paths_error_when_nothing_writable() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("not-a-dir");
        fs::write(&file, b"x").unwrap();
        assert!(resolve(&file.join("a"), Some(&file.join("b"))).is_err());
        assert!(resolve(&file.join("a"), None).is_err());
    }
}
