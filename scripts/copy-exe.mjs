// Copies the release build to the project root: E:\Ai Projects\Maple Classic Companion\MapleClassicCompanion.exe
// (the owner's requirement). Its data folder is created beside it on first run.
import { copyFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const from = resolve("src-tauri/target/release/MapleClassicCompanion.exe");
const to = resolve("MapleClassicCompanion.exe");
try {
  copyFileSync(from, to);
  console.log(`Copied ${(statSync(to).size / 1048576).toFixed(1)} MB → ${to}`);
} catch (err) {
  console.error(`Couldn't copy the exe (${err.code ?? err}). If the app is open, close it and run "npm run exe" again.`);
  process.exit(1);
}
