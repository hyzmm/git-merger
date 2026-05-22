import { describe, expect, test } from "bun:test";
import { imageMimeFromPath, isImagePath } from "./imageMime";

describe("imageMime", () => {
  test("recognises common raster formats", () => {
    expect(imageMimeFromPath("logo.png")).toBe("image/png");
    expect(imageMimeFromPath("photo.JPG")).toBe("image/jpeg");
    expect(imageMimeFromPath("anim.gif")).toBe("image/gif");
    expect(imageMimeFromPath("hero.webp")).toBe("image/webp");
  });

  test("recognises svg + avif + bmp + ico", () => {
    expect(imageMimeFromPath("icon.svg")).toBe("image/svg+xml");
    expect(imageMimeFromPath("art.avif")).toBe("image/avif");
    expect(imageMimeFromPath("old.bmp")).toBe("image/bmp");
    expect(imageMimeFromPath("favicon.ico")).toBe("image/x-icon");
  });

  test("returns null for non-image extensions and extension-less paths", () => {
    expect(imageMimeFromPath("README.md")).toBeNull();
    expect(imageMimeFromPath("Dockerfile")).toBeNull();
    expect(imageMimeFromPath("src/lib/foo.ts")).toBeNull();
    expect(imageMimeFromPath("noext")).toBeNull();
  });

  test("isImagePath agrees with imageMimeFromPath", () => {
    expect(isImagePath("a/b/c.png")).toBe(true);
    expect(isImagePath("a/b/c.txt")).toBe(false);
  });

  test("case-insensitive extension matching", () => {
    expect(isImagePath("HERO.WEBP")).toBe(true);
    expect(isImagePath("PHOTO.Jpeg")).toBe(true);
  });
});
