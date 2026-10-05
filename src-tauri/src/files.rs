//! Character exports and Quick note field notes (P2-T8, P2-T6b). Everything lives inside the data folder.
use crate::screenshots::check_image;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

fn e<T: std::fmt::Display>(x: T) -> String {
    x.to_string()
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(e)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(e)?;
        f.write_all(bytes).map_err(e)?;
        f.sync_all().map_err(e)?;
    }
    fs::rename(&tmp, path).map_err(e)
}

fn require_json(json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map(|_| ())
        .map_err(|x| format!("Refusing to save invalid JSON: {x}"))
}

/// Named folders the UI may open in Explorer.
pub fn named_folder(data_dir: &Path, which: &str) -> Result<PathBuf, String> {
    Ok(match which {
        "data" => data_dir.to_path_buf(),
        "backups" => data_dir.join("backups"),
        "exports" => data_dir.join("exports"),
        "field-notes" => data_dir.join("field-notes").join("inbox"),
        _ => return Err("Unknown folder".into()),
    })
}

/// `^[A-Za-z0-9 _.-]{1,80}\.json$` with no leading dot.
fn is_export_name(name: &str) -> bool {
    name.len() <= 85
        && name.ends_with(".json")
        && !name.starts_with('.')
        && name.len() > ".json".len()
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b' ' | b'_' | b'.' | b'-'))
        && !name.contains("..")
}

/// Writes an exported character into `<data>/exports/` and returns its full path.
pub fn export_save(data_dir: &Path, file_name: &str, json: &str) -> Result<String, String> {
    if !is_export_name(file_name) {
        return Err("Export file name contains characters that aren't allowed".into());
    }
    require_json(json)?;
    let path = data_dir.join("exports").join(file_name);
    write_atomic(&path, json.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

/// A note folder name is the UTC stamp `YYYYMMDDTHHMMSSmmmZ`, optionally with `-n` to avoid collisions.
fn is_note_id(id: &str) -> bool {
    let (stamp, suffix) = id.split_once('-').unwrap_or((id, "1"));
    let b = stamp.as_bytes();
    b.len() == 19
        && b[8] == b'T'
        && b[18] == b'Z'
        && b.iter().enumerate().all(|(i, c)| i == 8 || i == 18 || c.is_ascii_digit())
        && !suffix.is_empty()
        && suffix.len() <= 3
        && suffix.bytes().all(|c| c.is_ascii_digit())
}

fn inbox(data_dir: &Path) -> PathBuf {
    data_dir.join("field-notes").join("inbox")
}

/// Creates `<data>/field-notes/inbox/<stamp>/note.json`. Returns the note id (folder name).
pub fn field_note_create(data_dir: &Path, json: &str) -> Result<String, String> {
    require_json(json)?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let base = inbox(data_dir);
    let id = (1..1000)
        .map(|n| if n == 1 { stamp.clone() } else { format!("{stamp}-{n}") })
        .find(|id| !base.join(id).exists())
        .ok_or("Too many notes at once")?;
    write_atomic(&base.join(&id).join("note.json"), json.as_bytes())?;
    Ok(id)
}

/// Adds `img-<n>.<ext>` to an existing note. Returns the file name.
pub fn field_note_add_image(data_dir: &Path, note_id: &str, bytes: &[u8]) -> Result<String, String> {
    if !is_note_id(note_id) {
        return Err("Bad note id".into());
    }
    let dir = inbox(data_dir).join(note_id);
    if !dir.join("note.json").is_file() {
        return Err("Note not found".into());
    }
    let ext = check_image(bytes)?;
    let n = fs::read_dir(&dir).map_err(e)?.filter_map(|x| x.ok()).count(); // note.json + images so far
    let name = format!("img-{n}.{ext}");
    write_atomic(&dir.join(&name), bytes)?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0; 32]);
        v
    }

    #[test]
    fn files_note_with_images() {
        let tmp = tempfile::tempdir().unwrap();
        let id = field_note_create(tmp.path(), r#"{"text":"Lv 19 Blue Mushroom"}"#).unwrap();
        assert!(is_note_id(&id));
        assert_eq!(field_note_add_image(tmp.path(), &id, &png()).unwrap(), "img-1.png");
        assert_eq!(field_note_add_image(tmp.path(), &id, &png()).unwrap(), "img-2.png");
        let dir = tmp.path().join("field-notes/inbox").join(&id);
        assert!(dir.join("note.json").is_file() && dir.join("img-2.png").is_file());
    }

    #[test]
    fn files_two_notes_in_the_same_millisecond_do_not_collide() {
        let tmp = tempfile::tempdir().unwrap();
        let a = field_note_create(tmp.path(), "{}").unwrap();
        let b = field_note_create(tmp.path(), "{}").unwrap();
        assert_ne!(a, b);
        assert!(is_note_id(&b));
    }

    #[test]
    fn files_note_rejects_bad_input() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(field_note_create(tmp.path(), "not json").is_err());
        let id = field_note_create(tmp.path(), "{}").unwrap();
        assert!(field_note_add_image(tmp.path(), &id, b"<html>").is_err());
        assert!(field_note_add_image(tmp.path(), "../../x", &png()).is_err());
        assert!(field_note_add_image(tmp.path(), "20261005T000000000Z", &png()).is_err()); // missing
    }

    #[test]
    fn files_export_names_are_restricted() {
        let tmp = tempfile::tempdir().unwrap();
        let p = export_save(tmp.path(), "Taco Lv23 Bandit.json", "{}").unwrap();
        assert!(Path::new(&p).is_file());
        for bad in ["../x.json", "a/b.json", ".json", "x.exe", "x..json", "a:b.json"] {
            assert!(export_save(tmp.path(), bad, "{}").is_err(), "{bad}");
        }
        assert!(export_save(tmp.path(), "ok.json", "{bad").is_err());
    }

    #[test]
    fn files_named_folders() {
        let d = Path::new("D");
        assert_eq!(named_folder(d, "field-notes").unwrap(), d.join("field-notes").join("inbox"));
        assert!(named_folder(d, "../etc").is_err());
    }
}
