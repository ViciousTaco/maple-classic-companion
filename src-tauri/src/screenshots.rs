//! Character screenshots and the owner's own entity images (plan §8.3, §9.3). Bytes arrive as raw IPC bodies.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub const MAX_IMAGE_BYTES: usize = 400 * 1024;
const EXTS: [&str; 3] = ["webp", "png", "jpg"];

/// Returns the file extension for WebP / PNG / JPEG bytes, judged by magic bytes only.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else {
        None
    }
}

pub fn check_image(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!("Image is too large ({} KB, max 400 KB)", bytes.len() / 1024));
    }
    image_ext(bytes).ok_or_else(|| "Not a WebP, PNG or JPEG image".to_string())
}

pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// `^[A-Za-z0-9_-]{1,64}$`
pub fn is_entity_id(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

pub fn is_entity_kind(s: &str) -> bool {
    matches!(s, "monster" | "map" | "item" | "npc")
}

/// An image slot is `<dir>/<stem>.<ext>`; at most one extension exists at a time.
pub struct ImageSlot {
    pub dir: PathBuf,
    pub stem: String,
}

impl ImageSlot {
    pub fn screenshot(data_dir: &Path, profile_id: &str) -> Result<Self, String> {
        if !is_uuid(profile_id) {
            return Err("profileId must be a UUID".into());
        }
        Ok(Self { dir: data_dir.join("screenshots"), stem: profile_id.to_ascii_lowercase() })
    }

    pub fn entity(data_dir: &Path, kind: &str, id: &str) -> Result<Self, String> {
        if !is_entity_kind(kind) {
            return Err("kind must be monster, map, item or npc".into());
        }
        if !is_entity_id(id) {
            return Err("id must match ^[A-Za-z0-9_-]{1,64}$".into());
        }
        Ok(Self { dir: data_dir.join("images").join(kind), stem: id.to_string() })
    }

    /// Downloaded reference images (e.g. from an approved wiki), kept apart from the owner's own pictures.
    pub fn cached(data_dir: &Path, kind: &str, id: &str) -> Result<Self, String> {
        let mut slot = Self::entity(data_dir, kind, id)?;
        slot.dir = data_dir.join("cache").join("images").join(kind);
        Ok(slot)
    }

    /// Validates, writes atomically and removes any copy with a different extension. Returns the file name.
    pub fn save(&self, bytes: &[u8]) -> Result<String, String> {
        let ext = check_image(bytes)?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let name = format!("{}.{ext}", self.stem);
        let tmp = self.dir.join(format!("{name}.tmp"));
        {
            let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            f.write_all(bytes).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, self.dir.join(&name)).map_err(|e| e.to_string())?;
        for other in EXTS.iter().filter(|x| **x != ext) {
            let _ = fs::remove_file(self.dir.join(format!("{}.{other}", self.stem)));
        }
        Ok(name)
    }

    pub fn read(&self) -> Option<Vec<u8>> {
        EXTS.iter().find_map(|ext| fs::read(self.dir.join(format!("{}.{ext}", self.stem))).ok())
    }

    pub fn delete(&self) -> Result<(), String> {
        for ext in EXTS {
            let p = self.dir.join(format!("{}.{ext}", self.stem));
            if p.exists() {
                fs::remove_file(p).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11";

    fn webp(len: usize) -> Vec<u8> {
        let mut v = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        v.resize(len, 0);
        v
    }

    #[test]
    fn screenshot_round_trip_and_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let slot = ImageSlot::screenshot(tmp.path(), ID).unwrap();
        assert_eq!(slot.save(&webp(100)).unwrap(), format!("{ID}.webp"));
        assert_eq!(slot.read().unwrap().len(), 100);
        slot.delete().unwrap();
        assert!(slot.read().is_none());
    }

    #[test]
    fn screenshot_replacing_with_other_type_removes_old_file() {
        let tmp = tempfile::tempdir().unwrap();
        let slot = ImageSlot::screenshot(tmp.path(), ID).unwrap();
        slot.save(&webp(100)).unwrap();
        slot.save(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap();
        assert!(!slot.dir.join(format!("{ID}.webp")).exists());
        assert_eq!(slot.read().unwrap()[0], 0xFF);
    }

    #[test]
    fn screenshot_rejects_oversize_and_non_images() {
        let tmp = tempfile::tempdir().unwrap();
        let slot = ImageSlot::screenshot(tmp.path(), ID).unwrap();
        assert!(slot.save(&webp(MAX_IMAGE_BYTES + 1)).is_err());
        assert!(slot.save(b"GIF89a not allowed").is_err());
        assert!(slot.save(b"<html>").is_err());
        assert!(slot.read().is_none());
    }

    #[test]
    fn screenshot_cached_images_live_apart_from_own_images() {
        let tmp = tempfile::tempdir().unwrap();
        let own = ImageSlot::entity(tmp.path(), "monster", "blue-mushroom").unwrap();
        let cached = ImageSlot::cached(tmp.path(), "monster", "blue-mushroom").unwrap();
        cached.save(&webp(50)).unwrap();
        assert!(own.read().is_none());
        assert!(tmp.path().join("cache/images/monster/blue-mushroom.webp").is_file());
        assert!(ImageSlot::cached(tmp.path(), "boss", "x").is_err());
    }

    #[test]
    fn screenshot_rejects_bad_ids() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ImageSlot::screenshot(tmp.path(), "../../evil").is_err());
        assert!(ImageSlot::screenshot(tmp.path(), "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a1Z").is_err());
        assert!(ImageSlot::entity(tmp.path(), "boss", "a").is_err());
        assert!(ImageSlot::entity(tmp.path(), "monster", "..").is_err());
        assert!(ImageSlot::entity(tmp.path(), "monster", "").is_err());
        assert!(ImageSlot::entity(tmp.path(), "monster", &"a".repeat(65)).is_err());
        assert!(ImageSlot::entity(tmp.path(), "monster", "blue-mushroom_1").is_ok());
    }
}
