//! Installed datapacks: signed manifest check, staged install, swap and rollback (plan §8.6 steps 2, 7–10).
//!
//! Layout inside `<data>\packs\`:
//! - `<version>\`          one installed pack: its files + the signed `manifest.json` (+ `manifest.json.sig`)
//! - `staging-<version>\`  an install in progress; deleted on any failure
//! - `current.txt`         the active version; absent → the UI uses the bundled baseline
//!
//! `pack_install` takes each file's bytes as a **base64 string**: one JSON IPC payload can't carry several
//! raw binary bodies. Versions are `YYYY.MM.DD-n` and are validated before they become folder names.
use crate::{signing, AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    thread,
    time::Duration,
};
use tauri::State;

/// Prefix of the `pack_install` error that asks the UI to resend every file (plan §8.6 step 7).
pub const NEED_ALL_FILES: &str = "NEED_ALL_FILES";
/// Installed packs kept besides the active one.
pub const KEEP_PREVIOUS: usize = 2;
const CURRENT_FILE: &str = "current.txt";
const MANIFEST_FILE: &str = "manifest.json";

/// Serialises installs and rollbacks (staging folders, `current.txt`).
static PACK_LOCK: Mutex<()> = Mutex::new(());

fn e<T: std::fmt::Display>(x: T) -> String {
    x.to_string()
}

/// `YYYY.MM.DD-n` → `(YYYY, MM, DD, n)`; anything else is `None`. Compare versions as this tuple.
pub fn parse_version(v: &str) -> Option<(u32, u32, u32, u32)> {
    let (date, n) = v.split_once('-')?;
    let mut parts = date.split('.');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    let digits = |s: &str, min: usize, max: usize| {
        (min..=max).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_digit())
    };
    let shape = parts.next().is_none()
        && digits(y, 4, 4)
        && digits(m, 2, 2)
        && digits(d, 2, 2)
        && digits(n, 1, 6)
        && !(n.len() > 1 && n.starts_with('0'));
    if !shape {
        return None;
    }
    let (y, m, d, n) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?, n.parse().ok()?);
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((y, m, d, n))
}

fn is_device_name(stem: &str) -> bool {
    let b = stem.as_bytes();
    matches!(stem, "con" | "prn" | "aux" | "nul")
        || (b.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && b[3].is_ascii_digit())
}

/// `^[a-z0-9.-]+\.json$` (§8.3), and also: no `..`, no leading dot, no Windows device name, ≤ 128 chars.
pub fn is_pack_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".json") else {
        return false;
    };
    !stem.is_empty()
        && name.len() <= 128
        && name.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-')
        && !name.contains("..")
        && !name.starts_with('.')
        && !is_device_name(stem.split('.').next().unwrap_or_default())
}

#[derive(Debug, serde::Deserialize)]
struct ManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
}

/// The parts of `manifest.json` (§8.6) that Rust relies on; other fields are the UI's business.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema: u32,
    pack_version: String,
    files: Vec<ManifestFile>,
}

fn parse_manifest(json: &str) -> Result<Manifest, String> {
    let m: Manifest = serde_json::from_str(json).map_err(|x| format!("Manifest is not valid: {x}"))?;
    if m.schema != 1 {
        return Err(format!("Unsupported manifest schema {}", m.schema));
    }
    if parse_version(&m.pack_version).is_none() {
        return Err(format!("Bad packVersion {:?}", m.pack_version));
    }
    if m.files.is_empty() {
        return Err("Manifest lists no files".into());
    }
    let mut seen = HashSet::new();
    for f in &m.files {
        if !is_pack_file_name(&f.path) || f.path == MANIFEST_FILE {
            return Err(format!("Rejected file path {:?} in the manifest", f.path));
        }
        if !seen.insert(f.path.as_str()) {
            return Err(format!("{} is listed twice in the manifest", f.path));
        }
        if f.sha256.len() != 64 || !f.sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Bad sha256 for {}", f.path));
        }
    }
    Ok(m)
}

fn matches_manifest(bytes: &[u8], f: &ManifestFile) -> bool {
    bytes.len() as u64 == f.bytes && signing::sha256_hex(bytes).eq_ignore_ascii_case(&f.sha256)
}

/// Signature over the exact manifest bytes, then the manifest's own rules (§8.6 step 2).
pub fn verify_manifest(manifest_json: &str, signature: &str, public_key: &str) -> Result<(), String> {
    signing::verify(manifest_json.as_bytes(), signature, public_key)
        .map_err(|x| format!("Manifest signature rejected: {x}"))?;
    parse_manifest(manifest_json).map(|_| ())
}

/// One changed file sent by the UI. `bytes` is base64.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct IncomingFile {
    pub path: String,
    pub bytes: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PackActive {
    pub version: Option<String>,
    pub dir: Option<String>,
}

impl PackActive {
    fn none() -> Self {
        Self { version: None, dir: None }
    }
    fn of(packs: &Path, version: &str) -> Self {
        Self {
            version: Some(version.to_string()),
            dir: Some(packs.join(version).to_string_lossy().into_owned()),
        }
    }
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(e)?;
    f.write_all(bytes).map_err(e)?;
    f.sync_all().map_err(e)
}

/// Directory renames on Windows can fail briefly while a virus scanner holds a just-written file.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..10 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(err) => last = Some(err),
        }
        thread::sleep(Duration::from_millis(50 * (attempt + 1)));
    }
    Err(last.expect("at least one attempt"))
}

fn read_current(packs: &Path) -> Option<String> {
    let v = fs::read_to_string(packs.join(CURRENT_FILE)).ok()?;
    let v = v.trim();
    parse_version(v).map(|_| v.to_string())
}

/// `current.txt` via temp → rename.
fn write_current(packs: &Path, version: &str) -> Result<(), String> {
    let tmp = packs.join("current.txt.tmp");
    write_synced(&tmp, version.as_bytes())?;
    fs::rename(&tmp, packs.join(CURRENT_FILE)).map_err(e)
}

fn clear_current(packs: &Path) -> Result<(), String> {
    match fs::remove_file(packs.join(CURRENT_FILE)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(e(err)),
        _ => Ok(()),
    }
}

fn is_installed(packs: &Path, version: &str) -> bool {
    packs.join(version).join(MANIFEST_FILE).is_file()
}

/// Installed pack versions (folders with a valid version name and a manifest), newest first.
fn installed_versions(packs: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(packs) else {
        return vec![];
    };
    let mut v: Vec<String> = rd
        .filter_map(|x| x.ok())
        .filter_map(|x| x.file_name().into_string().ok())
        .filter(|n| parse_version(n).is_some() && is_installed(packs, n))
        .collect();
    v.sort_by_key(|n| std::cmp::Reverse(parse_version(n)));
    v
}

/// The active installed pack. If `current.txt` names a pack that is no longer on disk, rolls back first.
pub fn active(packs: &Path) -> PackActive {
    match read_current(packs) {
        Some(v) if is_installed(packs, &v) => PackActive::of(packs, &v),
        Some(_) => rollback(packs).unwrap_or_else(|_| PackActive::none()),
        None => PackActive::none(),
    }
}

/// Reads one file of the active installed pack (including its `manifest.json`).
pub fn read(packs: &Path, file: &str) -> Result<String, String> {
    if !is_pack_file_name(file) {
        return Err("file must match ^[a-z0-9.-]+\\.json$".into());
    }
    let dir = active(packs).dir.ok_or("No installed pack is active")?;
    fs::read_to_string(Path::new(&dir).join(file)).map_err(|x| format!("Can't read {file}: {x}"))
}

/// §8.6 step 10: the active pack failed to load. Deletes it (a later install of the same version
/// re-creates it) and points `current.txt` at the newest older installed pack, or removes
/// `current.txt` so the bundled baseline is used.
pub fn rollback(packs: &Path) -> Result<PackActive, String> {
    let _guard = PACK_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(current) = read_current(packs) else {
        clear_current(packs)?; // missing or unreadable → already on the baseline
        return Ok(PackActive::none());
    };
    let failed = parse_version(&current);
    let _ = fs::remove_dir_all(packs.join(&current));
    let previous = installed_versions(packs).into_iter().find(|v| parse_version(v) < failed);
    match previous {
        Some(v) => {
            write_current(packs, &v)?;
            Ok(PackActive::of(packs, &v))
        }
        None => {
            clear_current(packs)?;
            Ok(PackActive::none())
        }
    }
}

/// Keeps the active pack and the `KEEP_PREVIOUS` newest others; removes older packs and stale staging folders.
fn prune(packs: &Path, active_version: &str) {
    let mut kept = 0;
    for v in installed_versions(packs).into_iter().filter(|v| v != active_version) {
        if kept < KEEP_PREVIOUS {
            kept += 1;
        } else {
            let _ = fs::remove_dir_all(packs.join(v));
        }
    }
    let Ok(rd) = fs::read_dir(packs) else { return };
    for name in rd.filter_map(|x| x.ok()).filter_map(|x| x.file_name().into_string().ok()) {
        if name.starts_with("staging-") || name.starts_with("replaced-") {
            let _ = fs::remove_dir_all(packs.join(name));
        }
    }
}

/// §8.6 steps 7–9. `files` holds the changed files; unchanged ones are copied from the active installed
/// pack. If one isn't available there (the active pack is the bundled baseline, or the copy on disk no
/// longer matches), fails with an error starting with [`NEED_ALL_FILES`] before anything is written.
pub fn install(
    packs: &Path,
    manifest_json: &str,
    signature: &str,
    files: &[IncomingFile],
    public_key: &str,
) -> Result<String, String> {
    verify_manifest(manifest_json, signature, public_key)?;
    let manifest = parse_manifest(manifest_json)?;
    let version = manifest.pack_version.as_str();
    let listed: HashSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();

    let mut incoming: HashMap<&str, Vec<u8>> = HashMap::new();
    for f in files {
        if !is_pack_file_name(&f.path) {
            return Err(format!("Rejected file path {:?}", f.path));
        }
        if !listed.contains(f.path.as_str()) {
            return Err(format!("{} is not in the manifest", f.path));
        }
        let bytes =
            STANDARD.decode(f.bytes.trim()).map_err(|x| format!("{}: bytes are not base64: {x}", f.path))?;
        if incoming.insert(f.path.as_str(), bytes).is_some() {
            return Err(format!("{} was sent twice", f.path));
        }
    }

    let _guard = PACK_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let active_dir = read_current(packs).filter(|v| is_installed(packs, v)).map(|v| packs.join(v));
    let mut contents = Vec::with_capacity(manifest.files.len());
    for f in &manifest.files {
        let bytes = match incoming.remove(f.path.as_str()) {
            Some(b) => b,
            None => active_dir
                .as_ref()
                .and_then(|d| fs::read(d.join(&f.path)).ok())
                .filter(|b| matches_manifest(b, f))
                .ok_or_else(|| {
                    format!(
                        "{NEED_ALL_FILES}: {} is not in the active installed pack; send every file",
                        f.path
                    )
                })?,
        };
        contents.push((f, bytes));
    }

    // Step 7–8: write, then check what actually landed on disk.
    fs::create_dir_all(packs).map_err(e)?;
    let staging = packs.join(format!("staging-{version}"));
    let staged = (|| {
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(e)?;
        }
        fs::create_dir_all(&staging).map_err(e)?;
        for (f, bytes) in &contents {
            write_synced(&staging.join(&f.path), bytes)?;
        }
        write_synced(&staging.join(MANIFEST_FILE), manifest_json.as_bytes())?;
        write_synced(&staging.join("manifest.json.sig"), signature.as_bytes())?;
        for f in &manifest.files {
            let on_disk = fs::read(staging.join(&f.path)).map_err(e)?;
            if !matches_manifest(&on_disk, f) {
                return Err(format!(
                    "{} does not match the manifest (sha256 or size); install cancelled",
                    f.path
                ));
            }
        }
        Ok(())
    })();
    if let Err(err) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(err);
    }

    // Step 9: swap in. A re-install of an existing version moves the old copy aside first.
    let target = packs.join(version);
    let aside = packs.join(format!("replaced-{version}"));
    if target.exists() {
        let _ = fs::remove_dir_all(&aside);
        if let Err(err) = rename_with_retry(&target, &aside) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Can't replace pack {version}: {err}"));
        }
    }
    if let Err(err) = rename_with_retry(&staging, &target) {
        if aside.exists() {
            let _ = fs::rename(&aside, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Can't activate pack {version}: {err}"));
    }
    write_current(packs, version)?;
    prune(packs, version);
    Ok(version.to_string())
}

// ---------------------------------------------------------------- commands (§8.3)

fn packs_dir(state: &AppState) -> PathBuf {
    state.paths.data_dir.join("packs")
}

#[derive(serde::Serialize)]
pub struct VerifyResult {
    ok: bool,
    /// Why `ok` is false (additive to §8.3).
    error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct Installed {
    version: String,
}

#[tauri::command]
pub fn pack_active(state: State<'_, AppState>) -> PackActive {
    active(&packs_dir(&state))
}

#[tauri::command]
pub fn pack_read(state: State<'_, AppState>, file: String) -> Result<String, String> {
    read(&packs_dir(&state), &file)
}

#[tauri::command]
pub fn pack_verify_manifest(manifest_json: String, signature: String) -> VerifyResult {
    match verify_manifest(&manifest_json, &signature, signing::UPDATE_PUBLIC_KEY) {
        Ok(()) => VerifyResult { ok: true, error: None },
        Err(err) => VerifyResult { ok: false, error: Some(err) },
    }
}

#[tauri::command]
pub async fn pack_install(
    state: State<'_, AppState>,
    manifest_json: String,
    signature: String,
    files: Vec<IncomingFile>,
) -> Result<Installed, String> {
    let packs = packs_dir(&state);
    tauri::async_runtime::spawn_blocking(move || {
        install(&packs, &manifest_json, &signature, &files, signing::UPDATE_PUBLIC_KEY)
    })
    .await
    .map_err(e)?
    .map(|version| Installed { version })
}

#[tauri::command]
pub fn pack_rollback(state: State<'_, AppState>) -> Result<PackActive, String> {
    rollback(&packs_dir(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = include_str!("../tests/fixtures/test2.pub");
    const V1: &str = include_str!("../tests/fixtures/pack-v1.manifest.json");
    const V1_SIG: &str = include_str!("../tests/fixtures/pack-v1.manifest.json.sig");
    const V2: &str = include_str!("../tests/fixtures/pack-v2.manifest.json");
    const V2_SIG: &str = include_str!("../tests/fixtures/pack-v2.manifest.json.sig");
    const EVIL: &str = include_str!("../tests/fixtures/pack-evil.manifest.json");
    const EVIL_SIG: &str = include_str!("../tests/fixtures/pack-evil.manifest.json.sig");
    // File contents the fixture manifests were built from.
    const A1: &str = r#"{"a":1}"#;
    const A2: &str = r#"{"a":2}"#;
    const B1: &str = r#"{"b":1}"#;

    fn file(path: &str, data: &str) -> IncomingFile {
        IncomingFile { path: path.into(), bytes: STANDARD.encode(data) }
    }

    fn packs() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("packs");
        (tmp, p)
    }

    fn install_v1(p: &Path) {
        assert_eq!(
            install(p, V1, V1_SIG, &[file("a.json", A1), file("b.json", B1)], KEY).unwrap(),
            "2026.10.07-1"
        );
    }

    fn dirs(p: &Path) -> Vec<String> {
        let mut v: Vec<String> =
            fs::read_dir(p).unwrap().filter_map(|x| x.ok()?.file_name().into_string().ok()).collect();
        v.sort();
        v
    }

    /// Unsigned install for folder-handling tests (the signature path is covered separately).
    fn fake_pack(p: &Path, version: &str) {
        let dir = p.join(version);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.json"), A1).unwrap();
        fs::write(dir.join(MANIFEST_FILE), "{}").unwrap();
    }

    #[test]
    fn datapack_good_pack_installs_and_becomes_active() {
        let (_t, p) = packs();
        assert_eq!(active(&p), PackActive::none());
        install_v1(&p);
        let a = active(&p);
        assert_eq!(a.version.as_deref(), Some("2026.10.07-1"));
        assert_eq!(read(&p, "a.json").unwrap(), A1);
        assert_eq!(read(&p, "manifest.json").unwrap(), V1);
        assert_eq!(fs::read_to_string(p.join(CURRENT_FILE)).unwrap(), "2026.10.07-1");
        assert_eq!(dirs(&p), ["2026.10.07-1", "current.txt"]);
    }

    #[test]
    fn datapack_update_copies_unchanged_files_from_active_pack() {
        let (_t, p) = packs();
        install_v1(&p);
        // v2 changes a.json only; b.json comes from the installed v1.
        assert_eq!(install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap(), "2026.10.08-1");
        assert_eq!(read(&p, "a.json").unwrap(), A2);
        assert_eq!(read(&p, "b.json").unwrap(), B1);
        assert_eq!(dirs(&p), ["2026.10.07-1", "2026.10.08-1", "current.txt"]);
    }

    #[test]
    fn datapack_need_all_files_when_no_installed_pack() {
        let (_t, p) = packs();
        let err = install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap_err();
        assert!(err.starts_with(NEED_ALL_FILES), "{err}");
        assert!(!p.exists() || dirs(&p).is_empty(), "nothing written before NEED_ALL_FILES");
        // The UI retries with every file.
        install(&p, V2, V2_SIG, &[file("a.json", A2), file("b.json", B1)], KEY).unwrap();
        assert_eq!(read(&p, "b.json").unwrap(), B1);
    }

    #[test]
    fn datapack_need_all_files_when_active_copy_is_corrupt() {
        let (_t, p) = packs();
        install_v1(&p);
        fs::write(p.join("2026.10.07-1").join("b.json"), "{}").unwrap();
        let err = install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap_err();
        assert!(err.starts_with(NEED_ALL_FILES), "{err}");
    }

    #[test]
    fn datapack_bad_signature_rejected() {
        let (_t, p) = packs();
        let all = [file("a.json", A1), file("b.json", B1)];
        assert!(install(&p, V1, V2_SIG, &all, KEY).is_err()); // signature of another manifest
        let tampered = V1.replace("2026.10.07-1", "2026.10.07-2");
        assert!(install(&p, &tampered, V1_SIG, &all, KEY).is_err());
        assert!(install(&p, V1, V1_SIG, &all, signing::UPDATE_PUBLIC_KEY).is_err()); // wrong key
        assert!(install(&p, V1, "garbage", &all, KEY).is_err());
        assert!(!p.exists());
        assert!(verify_manifest(V1, V1_SIG, KEY).is_ok());
        assert!(verify_manifest(&tampered, V1_SIG, KEY).is_err());
    }

    #[test]
    fn datapack_path_traversal_rejected() {
        let (_t, p) = packs();
        for bad in
            ["../a.json", "..\\a.json", "x/a.json", "A.json", "a.json.exe", "con.json", ".a.json", "a..json"]
        {
            let err = install(&p, V1, V1_SIG, &[file(bad, A1), file("b.json", B1)], KEY).unwrap_err();
            assert!(err.contains("Rejected file path"), "{bad}: {err}");
        }
        // A file the manifest doesn't list.
        assert!(install(&p, V1, V1_SIG, &[file("a.json", A1), file("b.json", B1), file("c.json", A1)], KEY)
            .is_err());
        // A correctly signed manifest that lists a traversal path.
        let err = install(&p, EVIL, EVIL_SIG, &[file("../evil.json", A1)], KEY).unwrap_err();
        assert!(err.contains("Rejected file path"), "{err}");
        assert!(verify_manifest(EVIL, EVIL_SIG, KEY).is_err());
        assert!(!p.exists());
        assert!(read(&p, "../profiles.json").is_err());
    }

    #[test]
    fn datapack_hash_mismatch_rejected_and_staging_removed() {
        let (_t, p) = packs();
        let err = install(&p, V1, V1_SIG, &[file("a.json", A2), file("b.json", B1)], KEY).unwrap_err();
        assert!(err.contains("does not match the manifest"), "{err}");
        assert_eq!(dirs(&p), Vec::<String>::new());
        assert_eq!(active(&p), PackActive::none());
        // Same size, different bytes; and wrong size.
        assert!(install(&p, V1, V1_SIG, &[file("a.json", r#"{"a":9}"#), file("b.json", B1)], KEY).is_err());
        assert!(install(&p, V1, V1_SIG, &[file("a.json", A1), file("b.json", "{}")], KEY).is_err());
        assert_eq!(dirs(&p), Vec::<String>::new());
    }

    #[test]
    fn datapack_failed_install_keeps_previous_pack_active() {
        let (_t, p) = packs();
        install_v1(&p);
        assert!(install(&p, V2, V2_SIG, &[file("a.json", A1)], KEY).is_err()); // a.json has v1 bytes
        assert_eq!(active(&p).version.as_deref(), Some("2026.10.07-1"));
        assert_eq!(dirs(&p), ["2026.10.07-1", "current.txt"]);
    }

    #[test]
    fn datapack_reinstall_of_same_version_replaces_it() {
        let (_t, p) = packs();
        install_v1(&p);
        fs::write(p.join("2026.10.07-1").join("a.json"), "corrupt").unwrap();
        install_v1(&p);
        assert_eq!(read(&p, "a.json").unwrap(), A1);
        assert_eq!(dirs(&p), ["2026.10.07-1", "current.txt"]);
    }

    #[test]
    fn datapack_rollback_to_previous_then_baseline() {
        let (_t, p) = packs();
        install_v1(&p);
        install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap();
        let r = rollback(&p).unwrap();
        assert_eq!(r.version.as_deref(), Some("2026.10.07-1"));
        assert_eq!(active(&p), r);
        assert_eq!(read(&p, "a.json").unwrap(), A1);
        assert!(!p.join("2026.10.08-1").exists(), "the failed pack is removed");
        assert_eq!(rollback(&p).unwrap(), PackActive::none());
        assert!(!p.join(CURRENT_FILE).exists());
        assert_eq!(active(&p), PackActive::none());
        assert_eq!(rollback(&p).unwrap(), PackActive::none()); // already on the baseline
                                                               // A re-install after rollback works again.
        install(&p, V2, V2_SIG, &[file("a.json", A2), file("b.json", B1)], KEY).unwrap();
        assert_eq!(active(&p).version.as_deref(), Some("2026.10.08-1"));
    }

    #[test]
    fn datapack_rollback_when_active_pack_is_missing() {
        let (_t, p) = packs();
        install_v1(&p);
        install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap();
        fs::remove_dir_all(p.join("2026.10.08-1")).unwrap();
        // pack_active heals by itself; pack_read follows.
        assert_eq!(active(&p).version.as_deref(), Some("2026.10.07-1"));
        assert_eq!(fs::read_to_string(p.join(CURRENT_FILE)).unwrap(), "2026.10.07-1");
        assert_eq!(read(&p, "a.json").unwrap(), A1);
    }

    #[test]
    fn datapack_old_packs_pruned_to_two() {
        let (_t, p) = packs();
        for v in ["2026.10.01-1", "2026.10.02-1", "2026.10.03-1", "2026.10.03-2", "2026.10.03-10"] {
            fake_pack(&p, v);
        }
        fs::create_dir_all(p.join("staging-2026.09.30-1")).unwrap(); // left by a crash
        fs::write(p.join(CURRENT_FILE), "2026.10.03-10").unwrap();
        // Installing a newer pack (v1 fixture is 2026.10.07-1) keeps it + the two newest others.
        install(&p, V1, V1_SIG, &[file("a.json", A1), file("b.json", B1)], KEY).unwrap();
        assert_eq!(dirs(&p), ["2026.10.03-10", "2026.10.03-2", "2026.10.07-1", "current.txt"]);
        install(&p, V2, V2_SIG, &[file("a.json", A2)], KEY).unwrap();
        assert_eq!(dirs(&p), ["2026.10.03-10", "2026.10.07-1", "2026.10.08-1", "current.txt"]);
    }

    #[test]
    fn datapack_versions_and_names() {
        assert_eq!(parse_version("2026.10.07-1"), Some((2026, 10, 7, 1)));
        assert!(parse_version("2026.10.03-10") > parse_version("2026.10.03-2"));
        for bad in [
            "",
            "2026.10.07",
            "2026.10.07-",
            "2026.13.01-1",
            "2026.10.32-1",
            "26.10.07-1",
            "2026.10.07-01",
            "2026.10.07-1/..",
            "../2026.10.07-1",
            "2026.1.07-1",
            "2026.10.07.1-1",
            "2026.10.07-+1",
        ] {
            assert!(parse_version(bad).is_none(), "{bad}");
        }
        for good in ["monsters.json", "news-rules.json", "a.b.json", "manifest.json"] {
            assert!(is_pack_file_name(good), "{good}");
        }
        for bad in [
            "",
            ".json",
            "x.JSON",
            "x.txt",
            "../x.json",
            "x/y.json",
            "x\\y.json",
            "nul.json",
            "com1.json",
            "lpt9.x.json",
            "a..json",
            ".hidden.json",
            "x.json ",
            "é.json",
        ] {
            assert!(!is_pack_file_name(bad), "{bad}");
        }
        assert!(is_pack_file_name("console.json") && is_pack_file_name("com10.json"));
    }

    #[test]
    fn datapack_manifest_rules() {
        let ok = r#"{"schema":1,"packVersion":"2026.10.07-1","files":[{"path":"a.json","sha256":"015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862","bytes":7}]}"#;
        assert!(parse_manifest(ok).is_ok());
        assert!(parse_manifest(&ok.replace("\"schema\":1", "\"schema\":2")).is_err());
        assert!(parse_manifest(&ok.replace("2026.10.07-1", "..\\\\x")).is_err());
        assert!(parse_manifest(&ok.replace("a.json", "manifest.json")).is_err());
        assert!(parse_manifest(&ok.replace("015abd7f", "zzzzzzzz")).is_err());
        assert!(parse_manifest(r#"{"schema":1,"packVersion":"2026.10.07-1","files":[]}"#).is_err());
        let dup = ok.replace("}]}", r#"},{"path":"a.json","sha256":"015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862","bytes":7}]}"#);
        assert!(parse_manifest(&dup).is_err());
        assert!(parse_manifest("<html>").is_err());
    }

    #[test]
    fn datapack_rejects_bad_base64_and_duplicates() {
        let (_t, p) = packs();
        let bad = IncomingFile { path: "a.json".into(), bytes: "%%%".into() };
        assert!(install(&p, V1, V1_SIG, &[bad, file("b.json", B1)], KEY).is_err());
        assert!(install(&p, V1, V1_SIG, &[file("a.json", A1), file("a.json", A1), file("b.json", B1)], KEY)
            .is_err());
        assert!(!p.exists());
    }
}
