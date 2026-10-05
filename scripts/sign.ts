// P8-T2: sign a file with the update key → writes `<file>.sig` (tauri signer / minisign format, base64).
// Key source (first found): env TAURI_SIGNING_PRIVATE_KEY (CI secret MCC_SIGNING_KEY), env TAURI_SIGNING_PRIVATE_KEY_PATH,
// or the local key at .keys/mcc-signing.key. The private key never leaves this PC except as a GitHub secret.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function signFile(file: string): string {
  const cli = resolve("node_modules/@tauri-apps/cli/tauri.js");
  const env = { ...process.env };
  if (!env.TAURI_SIGNING_PRIVATE_KEY && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    const local = resolve(".keys/mcc-signing.key");
    if (!existsSync(local)) throw new Error("No signing key: set TAURI_SIGNING_PRIVATE_KEY or put the key at .keys/mcc-signing.key");
    env.TAURI_SIGNING_PRIVATE_KEY_PATH = local;
  }
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  const args = [cli, "signer", "sign"];
  if (env.TAURI_SIGNING_PRIVATE_KEY) args.push("-k", env.TAURI_SIGNING_PRIVATE_KEY);
  else args.push("-f", env.TAURI_SIGNING_PRIVATE_KEY_PATH!);
  args.push("-p", env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, file);
  // Keys never go on the command line in logs: stdout is suppressed.
  execFileSync(process.execPath, args, { env, stdio: ["ignore", "ignore", "inherit"] });
  const sig = `${file}.sig`;
  if (!existsSync(sig)) throw new Error(`Signing produced no ${sig}`);
  return readFileSync(sig, "utf8").trim();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/sign.ts <file>");
    process.exit(2);
  }
  signFile(resolve(file));
  console.log(`✓ signed ${file} → ${file}.sig`);
}
