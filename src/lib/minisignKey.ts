/**
 * Minimal minisign-key parsing helpers used by the `check-signing-key`
 * script and tested directly by `bun test`.
 *
 * Tauri stores both the .pub and .key files as text whose first line is:
 *
 *   `untrusted comment: minisign public key: <16 HEX KEYID>`            (.pub)
 *   `untrusted comment: minisign encrypted secret key: <16 HEX KEYID>`  (.key)
 *
 * When that comment line is present we just extract the hex; otherwise we
 * fall back to parsing the raw binary blob on the second line: minisign's
 * Ed25519 layout puts an 8-byte keyId immediately after a 2-byte algorithm
 * tag, so bytes [2..10] are the same fingerprint encoded in hex.
 *
 * Tauri additionally **base64-wraps** the entire .pub / .key file before
 * embedding it (in `tauri.conf.json::plugins.updater.pubkey` and in the
 * `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret). `decodeKeyWrapper` strips that
 * outer wrapper.
 */

const COMMENT_RE =
  /^untrusted comment:\s*minisign\s+(?:encrypted\s+)?(?:secret|public)\s+key(?::\s*(?<id>[0-9A-Fa-f]+))?/m;

/** Strip Tauri's outer base64 wrapping. Tolerates internal whitespace. */
export function decodeKeyWrapper(base64: string): string {
  const cleaned = base64.replace(/\s+/g, "");
  if (cleaned.length === 0) {
    throw new Error("empty key payload");
  }
  return Buffer.from(cleaned, "base64").toString("utf8");
}

/**
 * Extract the canonical 16-character uppercase keyId from a decoded
 * minisign key (either .pub or .key). Throws if the input doesn't look
 * like a minisign key at all.
 */
export function extractKeyId(decoded: string, label = "key"): string {
  const match = COMMENT_RE.exec(decoded);
  if (!match) {
    throw new Error(`${label}: not a minisign key (missing "untrusted comment" header)`);
  }
  const id = match.groups?.id;
  if (id) return id.toUpperCase();

  // Some minisign versions omit the keyId from the comment. Pull it from
  // the binary blob: after [sig_alg(2)] come 8 keyId bytes.
  const blobLine = decoded
    .split(/\r?\n/)
    .find((l) => l && !l.startsWith("untrusted") && !l.startsWith("trusted comment"));
  if (!blobLine) throw new Error(`${label}: minisign body has no payload line`);

  let raw: Buffer;
  try {
    raw = Buffer.from(blobLine, "base64");
  } catch {
    throw new Error(`${label}: payload line is not valid base64`);
  }
  if (raw.length < 10) {
    throw new Error(`${label}: minisign payload too short to contain a keyId`);
  }
  return raw.subarray(2, 10).toString("hex").toUpperCase();
}

/** End-to-end: a Tauri-wrapped key string → its uppercase hex keyId. */
export function fingerprintFromWrapped(wrapped: string, label = "key"): string {
  return extractKeyId(decodeKeyWrapper(wrapped), label);
}
