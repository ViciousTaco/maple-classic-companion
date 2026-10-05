//! Checks a file + its `.sig` against the update public key compiled into the app.
//! `cargo run --example verify_update_sig -- <file>` → "OK" or an error (used before publishing).
use maple_classic_companion_lib::signing::{verify, UPDATE_PUBLIC_KEY};

fn main() {
    let file = std::env::args().nth(1).expect("usage: verify_update_sig <file>");
    let data = std::fs::read(&file).expect("read file");
    let sig = std::fs::read_to_string(format!("{file}.sig")).expect("read .sig");
    match verify(&data, sig.trim(), UPDATE_PUBLIC_KEY) {
        Ok(()) => println!("OK: {file} is signed by the app's update key"),
        Err(e) => {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        }
    }
}
