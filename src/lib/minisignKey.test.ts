import { describe, expect, test } from "bun:test";
import { decodeKeyWrapper, extractKeyId, fingerprintFromWrapped } from "./minisignKey";

// The pubkey shipped in tauri.conf.json — used as a real-world fixture.
const REAL_PUBKEY_WRAPPED =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJGQTJBRDIwQzZBMDk1NzkKUldSNWxhREdJSzJpTDNRNlJVM3hzK3lBL25IRmZVRWxhbGpHZ0tldTNnV1hJRUMxa2J5blJPNlgK";

const REAL_PUBKEY_DECODED = `untrusted comment: minisign public key: 2FA2AD20C6A09579
RWR5laDGIK2iL3Q6RU3xs+yA/nHFfUElaljGgKeu3gWXIEC1kbynRO6X
`;

function wrap(plain: string): string {
  return Buffer.from(plain, "utf8").toString("base64");
}

describe("decodeKeyWrapper", () => {
  test("decodes the real shipped pubkey", () => {
    expect(decodeKeyWrapper(REAL_PUBKEY_WRAPPED)).toBe(REAL_PUBKEY_DECODED);
  });

  test("tolerates whitespace inside the wrapped value", () => {
    const padded = REAL_PUBKEY_WRAPPED.match(/.{1,40}/g)!.join("\n  ");
    expect(decodeKeyWrapper(padded)).toBe(REAL_PUBKEY_DECODED);
  });

  test("rejects empty input", () => {
    expect(() => decodeKeyWrapper("")).toThrow("empty key payload");
    expect(() => decodeKeyWrapper("   \n  \t ")).toThrow("empty key payload");
  });
});

describe("extractKeyId", () => {
  test("reads the keyId straight off the comment line of a public key", () => {
    expect(extractKeyId(REAL_PUBKEY_DECODED)).toBe("2FA2AD20C6A09579");
  });

  test("normalises lowercase hex to uppercase", () => {
    const decoded = `untrusted comment: minisign public key: deadbeefcafef00d
RWR5laDGIK2iL3Q6RU3xs+yA/nHFfUElaljGgKeu3gWXIEC1kbynRO6X
`;
    expect(extractKeyId(decoded)).toBe("DEADBEEFCAFEF00D");
  });

  test("recognises encrypted secret-key headers as well", () => {
    const decoded = `untrusted comment: minisign encrypted secret key: AABBCCDDEEFF0011
SOMECIPHERTEXTHERE/notreallybase64butlongenoughtopassthelengthcheck/=
`;
    expect(extractKeyId(decoded)).toBe("AABBCCDDEEFF0011");
  });

  test("falls back to the binary blob when the comment lacks a keyId", () => {
    // Build a fake payload whose bytes [2..10] are 0xAA repeated.
    const algo = Buffer.from([0x45, 0x64]); // 'Ed' — Ed25519 tag
    const id = Buffer.alloc(8, 0xaa);
    const filler = Buffer.alloc(40, 0);
    const blob = Buffer.concat([algo, id, filler]).toString("base64");
    const decoded = `untrusted comment: minisign public key
${blob}
`;
    expect(extractKeyId(decoded)).toBe("AAAAAAAAAAAAAAAA");
  });

  test("rejects strings that aren't minisign keys at all", () => {
    expect(() => extractKeyId("hello world", "demo")).toThrow(/not a minisign key/);
  });

  test("rejects truncated bodies that have no usable payload", () => {
    const decoded = `untrusted comment: minisign public key
abc
`;
    expect(() => extractKeyId(decoded)).toThrow(/payload too short/);
  });
});

describe("fingerprintFromWrapped (end-to-end)", () => {
  test("matches the shipped pubkey's keyId", () => {
    expect(fingerprintFromWrapped(REAL_PUBKEY_WRAPPED)).toBe("2FA2AD20C6A09579");
  });

  test("works on a freshly wrapped synthetic key too", () => {
    const decoded = `untrusted comment: minisign public key: BADDCAFE00112233
RWR5laDGIK2iL3Q6RU3xs+yA/nHFfUElaljGgKeu3gWXIEC1kbynRO6X
`;
    expect(fingerprintFromWrapped(wrap(decoded))).toBe("BADDCAFE00112233");
  });

  test("fails fast on a wrapped non-key", () => {
    expect(() => fingerprintFromWrapped(wrap("not a key"))).toThrow(/not a minisign key/);
  });
});
