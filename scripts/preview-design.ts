// Tiny static file server for the /design folder.
// Run: `bun run scripts/preview-design.ts`
import { serve, file } from "bun";
import { resolve, join, extname } from "node:path";
import { existsSync, statSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..", "design");
const PORT = Number(process.env.DESIGN_PORT ?? 5173);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    let pathname = new URL(req.url).pathname;
    if (pathname === "/") pathname = "/index.html";
    const fp = join(ROOT, decodeURIComponent(pathname));
    if (!fp.startsWith(ROOT) || !existsSync(fp) || statSync(fp).isDirectory()) {
      return new Response("Not Found", { status: 404 });
    }
    const ct = TYPES[extname(fp).toLowerCase()] ?? "application/octet-stream";
    return new Response(file(fp), { headers: { "Content-Type": ct } });
  },
});

console.log(`Design preview running at http://127.0.0.1:${PORT}/`);
