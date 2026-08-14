import * as CONST from "#foliplus/ExportControl/const.js";
import { describe, expect, it } from "vitest";

// export const STORAGE = { KEY: `foliplus_export_rect_${map.getContainer().id}` };
// map is window.map from setup.js — id is "test".
describe("STORAGE", () => {
  it("derives key from map container id", () => {
    expect(CONST.STORAGE.KEY).toContain("foliplus_export_rect_");
    expect(CONST.STORAGE.KEY).toContain("test");
  });
});

describe("CROP", () => {
  it("defines crop constraints", () => {
    expect(CONST.CROP.MIN_SIZE).toBe(40);
    expect(CONST.CROP.PADDING_RATIO).toBe(0.25);
    expect(CONST.CROP.CONTAINER_PADDING).toBe(200);
  });
});

describe("TIMING", () => {
  it("defines timing constants", () => {
    expect(CONST.TIMING.URL_REVOKE_DELAY).toBeGreaterThan(0);
    expect(CONST.TIMING.RESTORE_DELAY).toBeGreaterThan(0);
  });
});

describe("MIME", () => {
  it("maps format to mime type", () => {
    expect(CONST.MIME.png).toBe("image/png");
    expect(CONST.MIME.jpeg).toBe("image/jpeg");
    expect(CONST.MIME.webp).toBe("image/webp");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.COLLAPSED).toBe("collapsed");
    expect(CONST.CLASSES.LOCKED).toBe("locked");
    expect(CONST.CLASSES.DRAGGING).toBe("dragging");
  });
});

describe("SVG_NS", () => {
  it("is the SVG namespace", () => {
    expect(CONST.SVG_NS).toBe("http://www.w3.org/2000/svg");
  });
});

describe("SEL", () => {
  it("defines selectors", () => {
    expect(CONST.SEL.SKIP_EXPORT).toBe('[data-foliplus-export="exclude"]');
  });
});

describe("CACHE", () => {
  it("defines cache limits", () => {
    expect(CONST.CACHE.UNDO_MAX).toBe(20);
    expect(CONST.CACHE.TILE_MAX).toBe(1000);
  });
});

describe("TILE_CONCURRENCY", () => {
  it("is a positive integer", () => {
    expect(CONST.TILE_CONCURRENCY).toBe(6);
  });
});
