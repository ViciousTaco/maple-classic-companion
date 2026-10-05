//! Atomic JSON storage for player data with rolling backups and corruption recovery (plan §8.2).
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};

pub const KEEP_BACKUPS: usize = 20;
pub const BACKUP_INTERVAL: Duration = Duration::from_secs(60 * 60);
const STAMP_FMT: &str = "%Y%m%dT%H%M%S%3fZ";

fn e<T: std::fmt::Display>(x: T) -> String {
    x.to_string()
}

fn stamp() -> String {
    chrono::Utc::now().format(STAMP_FMT).to_string()
}

/// Validates JSON, optionally snapshots the previous file, then replaces atomically.
pub fn save_json_atomic(path: &Path, json: &str, backup_to: Option<&Path>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|x| format!("Refusing to save invalid JSON: {x}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(e)?;
    }
    if let (Some(dir), true) = (backup_to, path.exists()) {
        fs::create_dir_all(dir).map_err(e)?;
        fs::copy(path, dir.join(format!("profiles-{}.json", stamp()))).map_err(e)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(e)?;
        f.write_all(json.as_bytes()).map_err(e)?;
        f.sync_all().map_err(e)?;
    }
    fs::rename(&tmp, path).map_err(e) // replaces the existing file on Windows
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    /// ISO-8601 UTC time taken from the file name.
    pub saved_at: String,
}

fn is_backup_name(name: &str) -> bool {
    // profiles-YYYYMMDDTHHMMSSmmmZ.json
    let Some(mid) = name.strip_prefix("profiles-").and_then(|s| s.strip_suffix(".json")) else {
        return false;
    };
    let b = mid.as_bytes();
    b.len() == 19
        && b[8] == b'T'
        && b[18] == b'Z'
        && b.iter().enumerate().all(|(i, c)| i == 8 || i == 18 || c.is_ascii_digit())
}

fn saved_at_from_name(name: &str) -> String {
    let mid = &name["profiles-".len()..name.len() - ".json".len()];
    chrono::NaiveDateTime::parse_from_str(&mid[..18], "%Y%m%dT%H%M%S%3f")
        .map(|t| t.and_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// Backups newest first. The stamp in the name sorts lexicographically by time.
pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut names: Vec<String> = rd
        .filter_map(|x| x.ok())
        .filter_map(|x| x.file_name().into_string().ok())
        .filter(|n| is_backup_name(n))
        .collect();
    names.sort_unstable_by(|a, b| b.cmp(a));
    names
        .into_iter()
        .map(|n| BackupInfo { saved_at: saved_at_from_name(&n), file: n })
        .collect()
}

/// Deletes all but the newest `keep` backups.
pub fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    for old in list_backups(dir).into_iter().skip(keep) {
        fs::remove_file(dir.join(old.file)).map_err(e)?;
    }
    Ok(())
}

/// Age from the stamp in the name: `fs::copy` on Windows keeps the source's modified time.
fn newest_backup_age(dir: &Path, now: SystemTime) -> Option<Duration> {
    let newest = list_backups(dir).into_iter().next()?;
    let saved: SystemTime = chrono::DateTime::parse_from_rfc3339(&newest.saved_at).ok()?.into();
    Some(now.duration_since(saved).unwrap_or_default())
}

/// Logical-pixel window geometry stored in `profiles.json` → `settings.window`.
#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
pub struct WindowGeometry {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub maximized: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub json: Option<String>,
    /// `savedAt` of the backup that was restored because the main file was corrupt.
    pub restored_from_backup: Option<String>,
    /// Name of the corrupt file kept beside the data (additive to §8.3; logged in §14).
    pub corrupt_file: Option<String>,
}

/// Owns `profiles.json` and its backups. One per app; guarded by a mutex for the single writer rule.
pub struct ProfileStore {
    pub file: PathBuf,
    pub backup_dir: PathBuf,
    backed_up_this_session: Mutex<bool>,
}

impl ProfileStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            file: data_dir.join("profiles.json"),
            backup_dir: data_dir.join("backups"),
            backed_up_this_session: Mutex::new(false),
        }
    }

    /// Backup on the first save of a session and whenever the newest backup is over 60 minutes old.
    pub fn save(&self, json: &str) -> Result<(), String> {
        self.save_at(json, SystemTime::now())
    }

    pub fn save_at(&self, json: &str, now: SystemTime) -> Result<(), String> {
        let mut backed_up = self.backed_up_this_session.lock().map_err(e)?;
        let due = !*backed_up
            || newest_backup_age(&self.backup_dir, now).is_none_or(|age| age > BACKUP_INTERVAL);
        // Only counts as backed up when there was a previous file to copy.
        let will_back_up = due && self.file.exists();
        save_json_atomic(&self.file, json, will_back_up.then_some(self.backup_dir.as_path()))?;
        if will_back_up {
            *backed_up = true;
            prune_backups(&self.backup_dir, KEEP_BACKUPS)?;
        }
        Ok(())
    }

    /// Loads `profiles.json`. If it is corrupt: keep it as `profiles.corrupt-<stamp>.json`, restore the
    /// newest backup that parses, or start empty. Never silently discards data.
    pub fn load(&self) -> Result<LoadResult, String> {
        let empty = LoadResult { json: None, restored_from_backup: None, corrupt_file: None };
        if !self.file.exists() {
            return Ok(empty);
        }
        let text = fs::read_to_string(&self.file).unwrap_or_default();
        if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
            return Ok(LoadResult { json: Some(text), ..empty });
        }
        let corrupt_name = format!("profiles.corrupt-{}.json", stamp());
        fs::rename(&self.file, self.file.with_file_name(&corrupt_name)).map_err(e)?;
        for b in list_backups(&self.backup_dir) {
            let Ok(text) = fs::read_to_string(self.backup_dir.join(&b.file)) else { continue };
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                save_json_atomic(&self.file, &text, None)?;
                return Ok(LoadResult {
                    json: Some(text),
                    restored_from_backup: Some(b.saved_at),
                    corrupt_file: Some(corrupt_name),
                });
            }
        }
        Ok(LoadResult { corrupt_file: Some(corrupt_name), ..empty })
    }

    /// Snapshots the current file into backups now, e.g. before a restore replaces it.
    pub fn backup_now(&self) -> Result<(), String> {
        if !self.file.exists() {
            return Ok(());
        }
        fs::create_dir_all(&self.backup_dir).map_err(e)?;
        fs::copy(&self.file, self.backup_dir.join(format!("profiles-{}.json", stamp()))).map_err(e)?;
        prune_backups(&self.backup_dir, KEEP_BACKUPS)
    }

    /// Reads `settings.window` from the saved file, if present and sane (used before the UI loads).
    pub fn saved_window(&self) -> Option<WindowGeometry> {
        let text = fs::read_to_string(&self.file).ok()?;
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        let g: WindowGeometry = serde_json::from_value(v.get("settings")?.get("window")?.clone()).ok()?;
        let sane = (200.0..=10000.0).contains(&g.width) && (200.0..=10000.0).contains(&g.height);
        sane.then_some(g)
    }

    /// Returns the contents of a backup (the UI validates it and saves it as the current file).
    pub fn read_backup(&self, file: &str) -> Result<String, String> {
        if !is_backup_name(file) {
            return Err("Not a backup file name".into());
        }
        fs::read_to_string(self.backup_dir.join(file)).map_err(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ProfileStore) {
        let tmp = tempfile::tempdir().unwrap();
        let s = ProfileStore::new(tmp.path());
        (tmp, s)
    }

    #[test]
    fn storage_round_trip() {
        let (_t, s) = store();
        s.save(r#"{"a":1}"#).unwrap();
        assert_eq!(s.load().unwrap().json.as_deref(), Some(r#"{"a":1}"#));
        assert!(!s.file.with_extension("json.tmp").exists());
    }

    #[test]
    fn storage_refuses_invalid_json_and_keeps_original() {
        let (_t, s) = store();
        s.save(r#"{"a":1}"#).unwrap();
        assert!(s.save("{not json").is_err());
        assert_eq!(fs::read_to_string(&s.file).unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn storage_backs_up_on_first_save_of_session_only() {
        let (_t, s) = store();
        s.save(r#"{"v":1}"#).unwrap(); // no previous file → nothing to back up yet
        s.save(r#"{"v":2}"#).unwrap(); // session's backup (of v1)
        s.save(r#"{"v":3}"#).unwrap();
        assert_eq!(list_backups(&s.backup_dir).len(), 1);
        std::thread::sleep(Duration::from_millis(5)); // distinct stamp

        let s2 = ProfileStore::new(s.file.parent().unwrap()); // new session
        s2.save(r#"{"v":4}"#).unwrap();
        s2.save(r#"{"v":5}"#).unwrap();
        let b = list_backups(&s2.backup_dir);
        assert_eq!(b.len(), 2);
        assert_eq!(fs::read_to_string(s2.backup_dir.join(&b[0].file)).unwrap(), r#"{"v":3}"#);
    }

    #[test]
    fn storage_backs_up_again_after_an_hour() {
        let (_t, s) = store();
        s.save(r#"{"v":1}"#).unwrap();
        let s = ProfileStore::new(s.file.parent().unwrap());
        s.save(r#"{"v":2}"#).unwrap(); // first backup of the session
        std::thread::sleep(Duration::from_millis(5));
        let later = SystemTime::now() + BACKUP_INTERVAL + Duration::from_secs(1);
        s.save_at(r#"{"v":3}"#, later).unwrap();
        assert_eq!(list_backups(&s.backup_dir).len(), 2);
    }

    #[test]
    fn storage_prunes_backups_to_20() {
        let (_t, s) = store();
        fs::create_dir_all(&s.backup_dir).unwrap();
        for i in 0..25 {
            let name = format!("profiles-202610{:02}T120000000Z.json", i + 1);
            fs::write(s.backup_dir.join(name), "{}").unwrap();
        }
        prune_backups(&s.backup_dir, KEEP_BACKUPS).unwrap();
        let left = list_backups(&s.backup_dir);
        assert_eq!(left.len(), 20);
        assert_eq!(left[0].file, "profiles-20261025T120000000Z.json");
        assert_eq!(left[19].file, "profiles-20261006T120000000Z.json");
        assert_eq!(left[0].saved_at, "2026-10-25T12:00:00.000Z");
    }

    #[test]
    fn storage_restores_newest_good_backup_and_keeps_corrupt_copy() {
        let (_t, s) = store();
        fs::create_dir_all(&s.backup_dir).unwrap();
        fs::write(s.backup_dir.join("profiles-20261001T000000000Z.json"), r#"{"old":1}"#).unwrap();
        fs::write(s.backup_dir.join("profiles-20261002T000000000Z.json"), r#"{"good":2}"#).unwrap();
        fs::write(s.backup_dir.join("profiles-20261003T000000000Z.json"), "garbage").unwrap();
        fs::write(&s.file, "{truncated").unwrap();

        let r = s.load().unwrap();
        assert_eq!(r.json.as_deref(), Some(r#"{"good":2}"#));
        assert_eq!(r.restored_from_backup.as_deref(), Some("2026-10-02T00:00:00.000Z"));
        let corrupt = s.file.with_file_name(r.corrupt_file.unwrap());
        assert_eq!(fs::read_to_string(corrupt).unwrap(), "{truncated");
        assert_eq!(fs::read_to_string(&s.file).unwrap(), r#"{"good":2}"#);
    }

    #[test]
    fn storage_corrupt_without_backups_starts_empty_and_keeps_file() {
        let (_t, s) = store();
        fs::write(&s.file, "nope").unwrap();
        let r = s.load().unwrap();
        assert!(r.json.is_none() && r.restored_from_backup.is_none());
        assert!(s.file.with_file_name(r.corrupt_file.unwrap()).exists());
    }

    #[test]
    fn storage_backup_now_and_saved_window() {
        let (_t, s) = store();
        s.backup_now().unwrap(); // nothing to back up yet
        assert!(s.saved_window().is_none());
        s.save(r#"{"settings":{"window":{"width":1300,"height":820,"x":10,"y":20,"maximized":false}}}"#)
            .unwrap();
        s.backup_now().unwrap();
        assert_eq!(list_backups(&s.backup_dir).len(), 1);
        assert_eq!(s.saved_window().unwrap().width, 1300.0);
        s.save(r#"{"settings":{"window":{"width":5,"height":820,"x":10,"y":20,"maximized":false}}}"#)
            .unwrap();
        assert!(s.saved_window().is_none());
    }

    #[test]
    fn storage_read_backup_rejects_other_names() {
        let (_t, s) = store();
        assert!(s.read_backup("../profiles.json").is_err());
        assert!(s.read_backup("profiles-x.json").is_err());
    }
}
