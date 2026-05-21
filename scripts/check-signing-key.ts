#!/usr/bin/env bun
/**
 * Verify that the public key embedded in `tauri.conf.json` is the partner of
 * the private key supplied via `TAURI_SIGNING_PRIVATE_KEY` env (or the local
 * `~/.tauri/<id>.key` file when running locally).
 *
 * What this protects against:
 *   - Rotating the pubkey in `tauri.conf.json` without rotating the CI secret
 *   - Pasting the wrong .key into the GitHub Secret
 *   - Using the wrong key from a multi-app `~/.tauri/` directory
 *
 * Exits 0 on a match, non-zero on any mismatch / missing input — safe to
 * call as a CI gate. The actual minisign-parsing logic lives in
 * `src/lib/minisignKey.ts` and is covered by unit tests there.
 *
 * Usage:
 *   # local (reads ~/.tauri/<id>.key automatically if present)
 *   bun run scripts/check-signing-key.ts
 *
 *   # CI (the GitHub Secret is exposed as TAURI_SIGNING_PRIVATE_KEY)
 *   TAURI_SIGNING_PRIVATE_KEY="$KEY" bun run scripts/check-signing-key.ts
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fingerprintFromWrapped } from "../src/lib/minisignKey";

interface PrivateKeySource {
  source: string;
  content: string;
}

function readPubkeyFromConfig(): string {
  const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
  if (!existsSync(configPath)) {
    throw new Error(`tauri.conf.json not found at ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    plugins?: { updater?: { pubkey?: string } };
  };
  const pub = config.plugins?.updater?.pubkey;
  if (!pub) throw new Error("plugins.updater.pubkey is empty in tauri.conf.json");
  return pub;
}

function locatePrivateKey(): PrivateKeySource | null {
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (fromEnv && fromEnv.trim()) {
    return { source: "env TAURI_SIGNING_PRIVATE_KEY", content: fromEnv.trim() };
  }
  const tauriDir = join(homedir(), ".tauri");
  if (!existsSync(tauriDir)) return null;
  const candidates = readdirSync(tauriDir).filter((entry) => entry.endsWith(".key"));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      `multiple .key files in ~/.tauri (${candidates.join(", ")}); set TAURI_SIGNING_PRIVATE_KEY explicitly`,
    );
  }
  const path = join(tauriDir, candidates[0]!);
  return { source: path, content: readFileSync(path, "utf8") };
}

function main(): void {
  const pubFingerprint = fingerprintFromWrapped(readPubkeyFromConfig(), "tauri.conf.json pubkey");
  console.log(`pubkey  fingerprint: ${pubFingerprint}`);

  const priv = locatePrivateKey();
  if (!priv) {
    console.error(
      "✗ no private key available — set TAURI_SIGNING_PRIVATE_KEY or place a .key file under ~/.tauri/",
    );
    process.exit(1);
  }
  console.log(`privkey source     : ${priv.source}`);

  const privFingerprint = fingerprintFromWrapped(priv.content, priv.source);
  console.log(`privkey fingerprint: ${privFingerprint}`);

  if (pubFingerprint !== privFingerprint) {
    console.error(`✗ key id mismatch: pubkey=${pubFingerprint} privkey=${privFingerprint}`);
    process.exit(1);
  }
  console.log("✓ key pair matches — auto-update bundles will validate.");
}

try {
  main();
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}
