// Generate placeholder icons required by Tauri bundle.
// Run: `bun run scripts/gen-icons.ts`
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// 32x32 solid color PNG (deep slate w/ blue accent corner) — minimal hand-crafted PNG
// We emit it via a tiny PNG encoder for an arbitrary RGBA buffer, no deps.

function crc32(buf: Uint8Array): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1,
    b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function deflateStored(data: Uint8Array): Uint8Array {
  // zlib header + stored-block deflate + adler32. Simple & dependency-free.
  const out: number[] = [0x78, 0x01]; // zlib header (default compression flag, no dict)
  const blockMax = 65535;
  let i = 0;
  while (i < data.length) {
    const remain = data.length - i;
    const len = Math.min(blockMax, remain);
    const last = i + len === data.length ? 1 : 0;
    out.push(last);
    out.push(len & 0xff, (len >> 8) & 0xff);
    out.push(~len & 0xff, (~len >> 8) & 0xff);
    for (let j = 0; j < len; j++) out.push(data[i + j]);
    i += len;
  }
  const adler = adler32(data);
  out.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return new Uint8Array(out);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const typeBytes = new TextEncoder().encode(type);
  const buf = new Uint8Array(8 + len + 4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, len);
  buf.set(typeBytes, 4);
  buf.set(data, 8);
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + len, crc32(crcInput));
  return buf;
}

function makePng(size: number): Uint8Array {
  const w = size,
    h = size;
  // raster with alpha — simple gradient from top-left, with rounded square shape
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0; // filter byte = none
    for (let x = 0; x < w; x++) {
      const off = rowStart + 1 + x * 4;
      // Rounded-square mask
      const r = Math.min(x, y, w - 1 - x, h - 1 - y);
      const corner = 4;
      const alpha = r >= corner ? 255 : Math.max(0, 255 - (corner - r) * 80);
      // Color: dark slate base with subtle gradient
      const t = (x + y) / (w + h);
      raw[off] = Math.round(20 + t * 30); // R
      raw[off + 1] = Math.round(28 + t * 38); // G
      raw[off + 2] = Math.round(40 + t * 80); // B
      raw[off + 3] = alpha;
    }
  }
  // IHDR
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateStored(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  let total = sig.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(sig, p);
  p += sig.length;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function save(path: string, bytes: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (${bytes.length} B)`);
}

const dir = "src-tauri/icons";
const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);
save(`${dir}/32x32.png`, png32);
save(`${dir}/128x128.png`, png128);
save(`${dir}/128x128@2x.png`, png256);

// Minimal Windows .ico containing a single 32x32 PNG entry
function makeIco(png: Uint8Array, size: number): Uint8Array {
  const header = new Uint8Array(6);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 0, true); // reserved
  hv.setUint16(2, 1, true); // type = 1 ICO
  hv.setUint16(4, 1, true); // count
  const dir = new Uint8Array(16);
  const dv = new DataView(dir.buffer);
  dir[0] = size === 256 ? 0 : size; // width
  dir[1] = size === 256 ? 0 : size; // height
  dir[2] = 0; // palette
  dir[3] = 0; // reserved
  dv.setUint16(4, 1, true); // planes
  dv.setUint16(6, 32, true); // bpp
  dv.setUint32(8, png.length, true); // image size
  dv.setUint32(12, 6 + 16, true); // offset
  const out = new Uint8Array(6 + 16 + png.length);
  out.set(header, 0);
  out.set(dir, 6);
  out.set(png, 22);
  return out;
}
save(`${dir}/icon.ico`, makeIco(png32, 32));

// macOS .icns — minimal one-image (ic07 = 128x128 PNG).
function makeIcns(png: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const typeIc07 = enc.encode("ic07"); // 128x128 PNG
  const inner = new Uint8Array(8 + png.length);
  const iv = new DataView(inner.buffer);
  inner.set(typeIc07, 0);
  iv.setUint32(4, 8 + png.length);
  inner.set(png, 8);

  const file = new Uint8Array(8 + inner.length);
  const fv = new DataView(file.buffer);
  file.set(enc.encode("icns"), 0);
  fv.setUint32(4, 8 + inner.length);
  file.set(inner, 8);
  return file;
}
save(`${dir}/icon.icns`, makeIcns(png128));

console.log("All placeholder icons generated.");
