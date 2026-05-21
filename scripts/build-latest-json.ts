#!/usr/bin/env bun
/**
 * Aggregate per-platform updater bundles + their `.sig` companions into the
 * `latest.json` document that `tauri-plugin-updater` expects.
 *
 * Why we need this script: `tauri-action` uploads each platform's bundle and
 * its `.sig` separately to the GitHub Release, but it does NOT publish the
 * top-level `latest.json` index that the auto-updater fetches from
 *
 *   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
 *
 * Without it the updater can never see new versions even when signing keys
 * are configured correctly.
 *
 * Usage (local dry-run):
 *
 *   gh auth login   # once
 *   bun run scripts/build-latest-json.ts v0.13.2 hyzmm/git-merger
 *
 * In CI, GH_TOKEN comes from `${{ secrets.GITHUB_TOKEN }}` and the script is
 * driven by `.github/workflows/release.yml`.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

interface ReleaseAsset {
  name: string;
  // `gh release view --json assets` exposes either `apiUrl` or no URL field;
  // we synthesise the public download URL ourselves to be cache-friendly.
}

interface ReleaseInfo {
  tagName: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  body?: string | null;
}

/** Tauri's per-platform bucket key. Matches what the updater plugin asks for. */
type PlatformKey = "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64" | "linux-x86_64";

interface PlatformEntry {
  /** Asset name of the *signed* updater bundle (NOT the installer). */
  bundle: string;
  /** Asset name of the matching `.sig`. */
  sig: string;
}

interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<PlatformKey, { signature: string; url: string }>;
}

function fail(message: string): never {
  console.error(`build-latest-json: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} → exit ${r.status}\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function fetchRelease(tag: string, repo: string): ReleaseInfo {
  const stdout = run("gh", [
    "release",
    "view",
    tag,
    "--repo",
    repo,
    "--json",
    "tagName,publishedAt,assets,body",
  ]);
  return JSON.parse(stdout) as ReleaseInfo;
}

function downloadAssetText(tag: string, repo: string, name: string): string {
  // `gh release download --pattern '<name>' --output -` doesn't exist (the
  // CLI only allows directories), so we go through the GitHub API instead.
  // The /assets/{id} endpoint with Accept=application/octet-stream streams
  // the raw content; gh handles auth for us.
  const stdout = run("gh", [
    "api",
    "--method",
    "GET",
    "-H",
    "Accept: application/octet-stream",
    `/repos/${repo}/releases/tags/${tag}`,
  ]);
  const release = JSON.parse(stdout) as { assets: { id: number; name: string }[] };
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) fail(`asset ${name} not found on release ${tag}`);
  return run("gh", [
    "api",
    "-H",
    "Accept: application/octet-stream",
    `/repos/${repo}/releases/assets/${asset!.id}`,
  ]);
}

/**
 * Match each platform's *updater bundle* (NOT the installer) by file
 * extension. Tauri's bundler uses these conventions:
 *   - Windows: `<product>_<version>_x64-setup.nsis.zip`
 *   - macOS:   `<product>_<version>_<arch>.app.tar.gz`
 *   - Linux:   `<product>_<version>_amd64.AppImage.tar.gz`
 *
 * The companion signature file is always `<bundle>.sig`.
 */
function classify(name: string): PlatformKey | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".nsis.zip")) return "windows-x86_64";
  if (lower.endsWith(".app.tar.gz")) {
    return lower.includes("aarch64") || lower.includes("arm64")
      ? "darwin-aarch64"
      : "darwin-x86_64";
  }
  if (lower.endsWith(".appimage.tar.gz")) return "linux-x86_64";
  return null;
}

function pickPlatforms(assets: ReleaseAsset[]): Record<PlatformKey, PlatformEntry> {
  const out: Partial<Record<PlatformKey, PlatformEntry>> = {};
  const sigs = new Set(assets.filter((a) => a.name.endsWith(".sig")).map((a) => a.name));
  for (const a of assets) {
    if (a.name.endsWith(".sig")) continue;
    const key = classify(a.name);
    if (!key) continue;
    const sig = `${a.name}.sig`;
    if (!sigs.has(sig)) {
      console.warn(`build-latest-json: skipping ${a.name} — no companion ${sig}`);
      continue;
    }
    if (out[key]) {
      console.warn(
        `build-latest-json: duplicate platform ${key} (kept ${out[key]!.bundle}, ignoring ${a.name})`,
      );
      continue;
    }
    out[key] = { bundle: a.name, sig };
  }
  return out as Record<PlatformKey, PlatformEntry>;
}

function downloadUrl(repo: string, tag: string, asset: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset)}`;
}

function main() {
  const [tag, repo] = process.argv.slice(2);
  if (!tag || !repo) {
    fail("usage: build-latest-json.ts <tag> <owner/repo>");
  }
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    fail("GH_TOKEN (or GITHUB_TOKEN) must be set so `gh` can authenticate.");
  }

  console.log(`build-latest-json: tag=${tag} repo=${repo}`);
  const release = fetchRelease(tag!, repo!);
  console.log(`build-latest-json: ${release.assets.length} assets on the release`);

  const picked = pickPlatforms(release.assets);
  const platformEntries = Object.entries(picked) as [PlatformKey, PlatformEntry][];
  if (platformEntries.length === 0) {
    fail(
      "no signed updater bundles found — release is empty, or signing was skipped on every platform",
    );
  }

  const out: LatestJson = {
    version: tag!.replace(/^v/, ""),
    notes: release.body?.split(/\r?\n/).slice(0, 8).join("\n") ?? `Release ${tag}`,
    pub_date: release.publishedAt,
    platforms: {} as LatestJson["platforms"],
  };

  for (const [key, entry] of platformEntries) {
    const sig = downloadAssetText(tag!, repo!, entry.sig).trim();
    if (!sig) fail(`empty signature for ${entry.bundle}`);
    out.platforms[key] = {
      signature: sig,
      url: downloadUrl(repo!, tag!, entry.bundle),
    };
    console.log(`build-latest-json: ${key.padEnd(16)} ← ${entry.bundle}`);
  }

  writeFileSync("latest.json", JSON.stringify(out, null, 2));
  console.log("build-latest-json: wrote latest.json");
}

main();
