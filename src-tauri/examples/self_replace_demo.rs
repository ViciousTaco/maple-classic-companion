//! P1-T8 spike: a running exe replaces itself with a newer build and relaunches.
//! Usage: `demo.exe --update <new.exe>` → swaps, relaunches with `--report`, which writes its version beside it.
use std::{env, fs, path::PathBuf, process::Command};

const VERSION: &str = match option_env!("DEMO_VERSION") {
    Some(v) => v,
    None => "v1",
};

fn main() {
    let args: Vec<String> = env::args().collect();
    let exe = env::current_exe().expect("current exe");
    match args.get(1).map(String::as_str) {
        Some("--update") => {
            let new = PathBuf::from(args.get(2).expect("path to new exe"));
            self_replace::self_replace(&new).expect("self-replace");
            Command::new(&exe).arg("--report").spawn().expect("relaunch");
        }
        Some("--report") => fs::write(exe.with_file_name("demo-result.txt"), VERSION).expect("write"),
        _ => println!("{VERSION}"),
    }
}
