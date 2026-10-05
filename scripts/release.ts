// P10-T4: after `npm run exe`, prepare a GitHub release of the app.
//   tsx scripts/release.ts "What changed in this version"
// Writes releases/latest.json + .sig (served from GitHub Pages) pointing at
// https://github.com/ViciousTaco/maple-classic-companion/releases/download/v<version>/MapleClassicCompanion.exe
// Then: commit, tag v<version>, push, and upload MapleClassicCompanion.exe to the GitHub release (see docs/RELEASE.md).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { signFile } from "./sign";

const REPO = "https://github.com/ViciousTaco/maple-classic-companion";

const notes = process.argv.slice(2).join(" ").trim() || "Improvements and fixes.";
const exe = resolve("src-tauri/target/release/MapleClassicCompanion.exe");
const bytes = readFileSync(exe);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const signature = signFile(exe);
const version = pkg.version;
const latest = {
  version,
  notes,
  url: `${REPO}/releases/download/v${version}/MapleClassicCompanion.exe`,
  sha256,
  signature,
};
mkdirSync("releases", { recursive: true });
writeFileSync("releases/latest.json", JSON.stringify(latest, null, 2) + "\n");
signFile(resolve("releases/latest.json"));
console.log(`✓ releases/latest.json for v${version} (${(bytes.byteLength / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…)`);
console.log(`Next: git add releases && git commit -m "release v${version}" && git tag v${version} && git push --follow-tags`);
console.log(`Then upload ${exe} to ${REPO}/releases/new?tag=v${version}`);
