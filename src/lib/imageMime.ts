/** Lightweight, extension-based image detector for the diff Image preview.
 *
 * We deliberately don't sniff bytes — extensions catch the >99% case
 * (png/jpg/gif/webp/svg/avif/bmp/ico) and avoid an extra IPC roundtrip
 * just to peek at magic numbers. SVG is treated as both text-diffable
 * (the FileDiff is fine) and image-previewable (the renderer accepts
 * `image/svg+xml` data URLs).
 */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function imageMimeFromPath(p: string): string | null {
  const dot = p.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = p.slice(dot + 1).toLowerCase();
  return IMAGE_EXT_TO_MIME[ext] ?? null;
}

export function isImagePath(p: string): boolean {
  return imageMimeFromPath(p) !== null;
}
