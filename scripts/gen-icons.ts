/**
 * Generate the GitTools app icon set.
 *
 * Output:
 *   src-tauri/icons/32x32.png       — small Linux / taskbar
 *   src-tauri/icons/128x128.png     — Linux desktop default
 *   src-tauri/icons/128x128@2x.png  — HiDPI (256x256 actual)
 *   src-tauri/icons/icon.png        — 512x512 master (used by some Linux bundlers)
 *   src-tauri/icons/icon.ico        — Windows multi-size (16/32/48/64/128/256)
 *   src-tauri/icons/icon.icns       — macOS multi-size (16/32/64/128/256/512)
 *   src-tauri/icons/icon.svg        — vector source (README badge / packaging fallback)
 *
 * Design:
 *   - Rounded square (radius ≈ 18 % of side) with a deep blue → indigo
 *     diagonal gradient. Same colour ramp as the Topbar's primary accent
 *     so the icon feels native to the app.
 *   - Centered "git graph" glyph: three filled circles joined by two
 *     curved strokes — a main-branch node, a feature-branch fork, and a
 *     merge-back tip. Pure white at full opacity for maximum contrast.
 *   - Outer 1-px highlight ring at ~20 % white opacity to keep the icon
 *     readable on dark Windows / GNOME taskbars.
 *
 * Implementation notes:
 *   - Zero npm deps. We hand-build PNG (zlib stored blocks), ICO
 *     (multi-image directory), and ICNS (multi-type container).
 *   - All rasters are produced from a single `drawIcon(size)` so there's
 *     one source of truth for shape / colour. Bumping a constant updates
 *     every output uniformly.
 *
 * Run: `bun run gen:icons` (or `bun run scripts/gen-icons.ts`).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// PNG primitives (zlib stored-block deflate, no external deps)
// ---------------------------------------------------------------------------

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
  // zlib header + stored-block(s) + adler32. Stored blocks have a 5-byte
  // header per <=65535-byte chunk; not the smallest possible PNG but
  // perfectly valid and dependency-free.
  const out: number[] = [0x78, 0x01];
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

function pngChunk(type: string, data: Uint8Array): Uint8Array {
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

/**
 * Encode a (w * h * 4) RGBA Uint8Array as a PNG. The input must be
 * tightly packed (no per-row filter byte); this helper inserts the
 * filter-byte-0 prefix per row.
 */
function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  if (rgba.length !== w * h * 4) {
    throw new Error(`encodePng: expected ${w * h * 4} bytes, got ${rgba.length}`);
  }
  const stride = w * 4;
  const raw = new Uint8Array(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0; // filter type "none"
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression method (deflate)
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace
  const idat = deflateStored(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
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

// ---------------------------------------------------------------------------
// Canvas-style drawing (analytic + supersampled alpha for clean edges)
// ---------------------------------------------------------------------------

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function blend(dst: RGBA, src: RGBA): RGBA {
  // Standard "source over" alpha compositing in straight-alpha space.
  const sa = src.a / 255;
  const da = dst.a / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round((src.r * sa + dst.r * da * (1 - sa)) / oa),
    g: Math.round((src.g * sa + dst.g * da * (1 - sa)) / oa),
    b: Math.round((src.b * sa + dst.b * da * (1 - sa)) / oa),
    a: Math.round(oa * 255),
  };
}

/**
 * Smoothstep — analytic anti-aliased coverage for an SDF (signed-distance
 * field). `d` is in pixels; negative = inside, positive = outside. Returns
 * 1.0 fully-inside, 0.0 fully-outside, smooth band roughly 1px wide.
 */
function aa(d: number): number {
  if (d <= -0.5) return 1;
  if (d >= 0.5) return 0;
  return 0.5 - d;
}

/** Signed-distance to a rounded rectangle centred at `cx,cy`. */
function sdRoundRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  r: number,
): number {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed-distance to a circle. */
function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

/** Signed-distance to a line segment with thickness `thick` (full width). */
function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thick: number,
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy) - thick / 2;
}

/**
 * Signed-distance to a quadratic Bézier with thickness `thick`. We sample
 * 24 sub-segments and take the minimum; that's plenty for icon-grade
 * smoothness without inheriting an SDF library.
 */
function sdQuadraticBezier(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  thick: number,
): number {
  const STEPS = 24;
  let prevX = ax;
  let prevY = ay;
  let best = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    const qx = u * u * ax + 2 * u * t * bx + t * t * cx;
    const qy = u * u * ay + 2 * u * t * by + t * t * cy;
    const d = sdSegment(px, py, prevX, prevY, qx, qy, thick);
    if (d < best) best = d;
    prevX = qx;
    prevY = qy;
  }
  return best;
}

// ---------------------------------------------------------------------------
// drawIcon — single source of truth for the visual
// ---------------------------------------------------------------------------

/**
 * Render the GitTools icon at the given size. All coordinates are in pixels
 * but proportions are relative to `size`, so 32 / 128 / 256 / 512 / 1024
 * all share the same look.
 */
function drawIcon(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  // Background gradient (deep blue → indigo). HSL-ish hand-picked.
  const bgTop: RGBA = { r: 30, g: 41, b: 82, a: 255 };
  const bgBot: RGBA = { r: 60, g: 41, b: 122, a: 255 };
  const ringColor: RGBA = { r: 255, g: 255, b: 255, a: 50 };
  const fg: RGBA = { r: 255, g: 255, b: 255, a: 255 };
  const fgDim: RGBA = { r: 255, g: 255, b: 255, a: 220 };

  // Geometry — proportional to canvas size
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2 - Math.max(1, size * 0.015); // 1.5 % padding so AA has room
  const radius = size * 0.22; // rounded-corner radius

  // Three nodes laid out in a zig-zag:
  //   • top: main-branch node
  //   • middle-right: feature fork
  //   • bottom: merge-back tip
  // Coordinates are picked so the connecting curves form a clean "git graph"
  // shape that reads even at 16 px.
  const nodeR = size * 0.085;
  const smallR = size * 0.07;
  const nodes: { x: number; y: number; r: number }[] = [
    { x: cx - size * 0.16, y: cy - size * 0.22, r: nodeR }, // main top
    { x: cx + size * 0.18, y: cy, r: smallR }, // feature
    { x: cx - size * 0.16, y: cy + size * 0.22, r: nodeR }, // main bottom
  ];

  // Stroke thickness scales with the icon to keep visual weight consistent.
  const stroke = Math.max(1.2, size * 0.04);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // 1) Rounded-rect background
      const dRect = sdRoundRect(px, py, cx, cy, half, half, radius);
      const rectCov = aa(dRect);
      if (rectCov <= 0) continue; // outside icon

      // Diagonal gradient
      const t = Math.min(1, Math.max(0, (x + y) / (2 * size)));
      let pixel: RGBA = {
        r: Math.round(bgTop.r * (1 - t) + bgBot.r * t),
        g: Math.round(bgTop.g * (1 - t) + bgBot.g * t),
        b: Math.round(bgTop.b * (1 - t) + bgBot.b * t),
        a: Math.round(255 * rectCov),
      };

      // 2) Inner highlight ring (1 px band, just inside the rounded edge).
      // Sits between dRect ∈ [-2px, -1px] for clean contrast.
      const ringInner = -Math.max(1, size * 0.012);
      const ringOuter = ringInner + Math.max(1, size * 0.012);
      if (dRect >= ringInner && dRect <= ringOuter) {
        const ringT = 1 - Math.abs((dRect - (ringInner + ringOuter) / 2) / (ringOuter - ringInner));
        pixel = blend(pixel, { ...ringColor, a: Math.round(ringColor.a * ringT * rectCov) });
      }

      // 3) Connecting curves. Two quadratic Béziers form the branch arcs.
      // Curve A: top main → feature fork (bulges right).
      const curveA = sdQuadraticBezier(
        px,
        py,
        nodes[0].x,
        nodes[0].y,
        cx + size * 0.22,
        cy - size * 0.04,
        nodes[1].x,
        nodes[1].y,
        stroke,
      );
      // Curve B: feature fork → bottom main (bulges right, mirror of A).
      const curveB = sdQuadraticBezier(
        px,
        py,
        nodes[1].x,
        nodes[1].y,
        cx + size * 0.22,
        cy + size * 0.04,
        nodes[2].x,
        nodes[2].y,
        stroke,
      );
      // Trunk: top main → bottom main (straight line).
      const trunk = sdSegment(
        px,
        py,
        nodes[0].x,
        nodes[0].y,
        nodes[2].x,
        nodes[2].y,
        stroke * 1.05,
      );
      const lineD = Math.min(curveA, curveB, trunk);
      const lineCov = aa(lineD) * rectCov;
      if (lineCov > 0) {
        pixel = blend(pixel, { ...fgDim, a: Math.round(fgDim.a * lineCov) });
      }

      // 4) Three solid nodes, drawn after the strokes so they sit on top.
      let bestNode = Infinity;
      for (const n of nodes) {
        const dn = sdCircle(px, py, n.x, n.y, n.r);
        if (dn < bestNode) bestNode = dn;
      }
      const nodeCov = aa(bestNode) * rectCov;
      if (nodeCov > 0) {
        pixel = blend(pixel, { ...fg, a: Math.round(fg.a * nodeCov) });
      }

      const off = (y * size + x) * 4;
      out[off] = pixel.r;
      out[off + 1] = pixel.g;
      out[off + 2] = pixel.b;
      out[off + 3] = pixel.a;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Container formats: ICO (Windows), ICNS (macOS)
// ---------------------------------------------------------------------------

interface IconEntry {
  size: number;
  png: Uint8Array;
}

/**
 * Build a Windows .ico file from one or more PNG entries. Each entry uses
 * the PNG-in-ICO format (Vista+ supported, fine for our targets).
 */
function makeIco(entries: IconEntry[]): Uint8Array {
  const N = entries.length;
  const header = new Uint8Array(6);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 0, true); // reserved
  hv.setUint16(2, 1, true); // type 1 = ICO
  hv.setUint16(4, N, true); // image count

  const dirSize = 16 * N;
  const dirs = new Uint8Array(dirSize);
  // Image data is concatenated after header + directory.
  let dataOffset = 6 + dirSize;
  let totalDataLen = 0;
  for (const e of entries) totalDataLen += e.png.length;
  const out = new Uint8Array(6 + dirSize + totalDataLen);

  for (let i = 0; i < N; i++) {
    const e = entries[i];
    const dv = new DataView(dirs.buffer, i * 16, 16);
    // ICO directory entries store width / height as a single byte where
    // 0 means 256.
    dirs[i * 16 + 0] = e.size === 256 ? 0 : e.size; // width
    dirs[i * 16 + 1] = e.size === 256 ? 0 : e.size; // height
    dirs[i * 16 + 2] = 0; // palette colours (0 = no palette)
    dirs[i * 16 + 3] = 0; // reserved
    dv.setUint16(4, 1, true); // colour planes
    dv.setUint16(6, 32, true); // bits per pixel
    dv.setUint32(8, e.png.length, true); // image data size
    dv.setUint32(12, dataOffset, true); // offset into file
    out.set(e.png, dataOffset);
    dataOffset += e.png.length;
  }

  out.set(header, 0);
  out.set(dirs, 6);
  return out;
}

/** ICNS type tags for the modern PNG-based icon sizes. */
const ICNS_TYPES: Record<number, string> = {
  16: "icp4",
  32: "icp5",
  64: "icp6",
  128: "ic07",
  256: "ic08",
  512: "ic09",
  1024: "ic10",
};

/** Build a macOS .icns file from one or more PNG entries. */
function makeIcns(entries: IconEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const tag = ICNS_TYPES[e.size];
    if (!tag) throw new Error(`unsupported ICNS size: ${e.size}`);
    const block = new Uint8Array(8 + e.png.length);
    const dv = new DataView(block.buffer);
    block.set(enc.encode(tag), 0);
    dv.setUint32(4, 8 + e.png.length); // big-endian (default)
    block.set(e.png, 8);
    blocks.push(block);
  }
  let inner = 0;
  for (const b of blocks) inner += b.length;
  const file = new Uint8Array(8 + inner);
  const fv = new DataView(file.buffer);
  file.set(enc.encode("icns"), 0);
  fv.setUint32(4, 8 + inner);
  let off = 8;
  for (const b of blocks) {
    file.set(b, off);
    off += b.length;
  }
  return file;
}

// ---------------------------------------------------------------------------
// SVG companion (for README + any vector consumer)
// ---------------------------------------------------------------------------

function makeSvg(): string {
  // The numbers below mirror drawIcon()'s 256-px-equivalent geometry so
  // the vector and the raster look the same. Coordinates are in a
  // 0..256 viewBox for round numbers.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="GitTools icon">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e2952" />
      <stop offset="1" stop-color="#3c297a" />
    </linearGradient>
  </defs>
  <rect x="3.84" y="3.84" width="248.32" height="248.32" rx="56.32" ry="56.32" fill="url(#bg)" />
  <rect x="3.84" y="3.84" width="248.32" height="248.32" rx="56.32" ry="56.32"
        fill="none" stroke="white" stroke-opacity="0.20" stroke-width="3.07" />
  <!-- branch curves: top → fork → bottom (right bulge) -->
  <path d="M 87 71 Q 184 122 174 128" stroke="white" stroke-opacity="0.86"
        stroke-width="10.24" stroke-linecap="round" fill="none" />
  <path d="M 174 128 Q 184 134 87 185" stroke="white" stroke-opacity="0.86"
        stroke-width="10.24" stroke-linecap="round" fill="none" />
  <!-- straight trunk -->
  <line x1="87" y1="71" x2="87" y2="185" stroke="white" stroke-opacity="0.86"
        stroke-width="10.75" stroke-linecap="round" />
  <!-- nodes -->
  <circle cx="87"  cy="71"  r="21.76" fill="white" />
  <circle cx="174" cy="128" r="17.92" fill="white" />
  <circle cx="87"  cy="185" r="21.76" fill="white" />
</svg>
`;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function save(path: string, bytes: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  if (typeof bytes === "string") {
    writeFileSync(path, bytes, "utf8");
    console.log(`wrote ${path} (${bytes.length} chars)`);
  } else {
    writeFileSync(path, bytes);
    console.log(`wrote ${path} (${bytes.length} B)`);
  }
}

const dir = "src-tauri/icons";

console.log("rendering rasters...");
// Generate everything we need from the same source-of-truth function.
// 16/32/48/64 → ICO multi-image; 128 → Linux desktop default + ICNS;
// 256 → HiDPI @2x + ICNS top tier + ICO 256.
const sizes = [16, 32, 48, 64, 128, 256] as const;
const rgba = new Map<number, Uint8Array>();
const png = new Map<number, Uint8Array>();
for (const s of sizes) {
  rgba.set(s, drawIcon(s));
  png.set(s, encodePng(rgba.get(s)!, s, s));
  console.log(`  rendered ${s}x${s}`);
}

console.log("writing PNGs...");
save(`${dir}/32x32.png`, png.get(32)!);
save(`${dir}/128x128.png`, png.get(128)!);
save(`${dir}/128x128@2x.png`, png.get(256)!);
// Linux fallback (some bundlers ask for `icon.png`). 128 px is the usual
// "app menu" size on GNOME / KDE; HiDPI hosts get the @2x raster above.
save(`${dir}/icon.png`, png.get(128)!);

console.log("writing ICO...");
save(
  `${dir}/icon.ico`,
  makeIco([
    { size: 16, png: png.get(16)! },
    { size: 32, png: png.get(32)! },
    { size: 48, png: png.get(48)! },
    { size: 64, png: png.get(64)! },
    { size: 128, png: png.get(128)! },
    { size: 256, png: png.get(256)! },
  ]),
);

console.log("writing ICNS...");
// Stop at 256 (`ic08`) — 512 (`ic09`) bloats the file by ~700 KB because
// our zero-dep deflate is "stored blocks" (effectively no compression),
// and that's not a worthwhile tradeoff until we ship an actual macOS
// build pipeline. Easy to add back when needed.
save(
  `${dir}/icon.icns`,
  makeIcns([
    { size: 16, png: png.get(16)! },
    { size: 32, png: png.get(32)! },
    { size: 64, png: png.get(64)! },
    { size: 128, png: png.get(128)! },
    { size: 256, png: png.get(256)! },
  ]),
);

console.log("writing SVG...");
save(`${dir}/icon.svg`, makeSvg());

console.log("done.");
