//! P2-T9: saves continuously through the real storage code so a test can kill it mid-write.
//! `torture_writer <dir> write` loops forever; `torture_writer <dir> check` loads and prints the counter.
use maple_classic_companion_lib::storage::ProfileStore;
use std::{env, path::PathBuf};

fn main() {
    let args: Vec<String> = env::args().collect();
    let dir = PathBuf::from(&args[1]);
    let store = ProfileStore::new(&dir);
    match args[2].as_str() {
        "write" => {
            let start = store
                .load()
                .ok()
                .and_then(|r| r.json)
                .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
                .and_then(|v| v["counter"].as_u64())
                .unwrap_or(0);
            for n in start + 1.. {
                // ~200 KB of payload so a kill often lands mid-write.
                let json = serde_json::json!({ "counter": n, "padding": "x".repeat(200_000) }).to_string();
                store.save(&json).expect("save");
            }
        }
        _ => {
            let r = store.load().expect("load");
            let v: serde_json::Value = serde_json::from_str(r.json.as_deref().expect("file present")).expect("parses");
            println!(
                "counter={} restored={:?} corrupt={:?}",
                v["counter"], r.restored_from_backup, r.corrupt_file
            );
        }
    }
}
