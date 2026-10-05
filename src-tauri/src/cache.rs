//! Small JSON caches for network data (news index/articles, feed metadata): `<data>\cache\<key>.json`.
use crate::{storage, AppState};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

/// `^[a-z0-9-]{1,64}$`
pub fn is_cache_key(key: &str) -> bool {
    (1..=64).contains(&key.len())
        && key.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn cache_file(data_dir: &Path, key: &str) -> Result<PathBuf, String> {
    if !is_cache_key(key) {
        return Err("key must match ^[a-z0-9-]{1,64}$".into());
    }
    Ok(data_dir.join("cache").join(format!("{key}.json")))
}

/// `None` when there is no entry, or the stored file no longer parses (treated as a cache miss).
pub fn read(data_dir: &Path, key: &str) -> Result<Option<String>, String> {
    let path = cache_file(data_dir, key)?;
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(None);
    };
    Ok(serde_json::from_str::<serde_json::Value>(&text).is_ok().then_some(text))
}

/// Validates the JSON and replaces the entry atomically (temp → rename).
pub fn write(data_dir: &Path, key: &str, json: &str) -> Result<(), String> {
    storage::save_json_atomic(&cache_file(data_dir, key)?, json, None)
}

#[tauri::command]
pub fn cache_read(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    read(&state.paths.data_dir, &key)
}

#[tauri::command]
pub fn cache_write(state: State<'_, AppState>, key: String, json: String) -> Result<(), String> {
    write(&state.paths.data_dir, &key, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trip_and_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read(tmp.path(), "news-index").unwrap(), None);
        write(tmp.path(), "news-index", r#"{"items":[1]}"#).unwrap();
        write(tmp.path(), "news-index", r#"{"items":[1,2]}"#).unwrap();
        assert_eq!(read(tmp.path(), "news-index").unwrap().as_deref(), Some(r#"{"items":[1,2]}"#));
        assert!(tmp.path().join("cache/news-index.json").is_file());
        assert!(!tmp.path().join("cache/news-index.json.tmp").exists());
    }

    #[test]
    fn cache_refuses_invalid_json_and_keeps_old_entry() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "feed", "[1]").unwrap();
        assert!(write(tmp.path(), "feed", "<html>").is_err());
        assert_eq!(read(tmp.path(), "feed").unwrap().as_deref(), Some("[1]"));
    }

    #[test]
    fn cache_corrupt_file_reads_as_miss() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("cache")).unwrap();
        fs::write(tmp.path().join("cache/feed.json"), "{trunc").unwrap();
        assert_eq!(read(tmp.path(), "feed").unwrap(), None);
    }

    #[test]
    fn cache_keys_are_restricted() {
        let tmp = tempfile::tempdir().unwrap();
        for bad in ["", "../x", "a/b", "A", "a.b", "a_b", "a b", &"a".repeat(65)] {
            assert!(write(tmp.path(), bad, "{}").is_err(), "{bad}");
            assert!(read(tmp.path(), bad).is_err(), "{bad}");
        }
        assert!(is_cache_key("news-45621") && is_cache_key(&"a".repeat(64)));
    }
}
