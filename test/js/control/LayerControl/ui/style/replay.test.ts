// test for foliplus/js/control/LayerControl/ui/style/replay.ts
//
// The bridge contract: a writer (fill) may commit before any owner (border)
// has registered its replay for the face — the bridge must no-op silently,
// never throw and never schedule an apply for a face nobody owns.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerFaceReplay,
  replayFace,
} from "#control/LayerControl/ui/style/replay.js";
import { FACE } from "#control/LayerControl/ui/style/styleBag.js";

describe("style replay bridge", () => {
  const ui = { id: "ui-1" } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when no owner has registered the face (writer before owner)", () => {
    expect(() => replayFace(ui, "poly1", FACE.STROKE)).not.toThrow();
  });

  it("runs the registered replay for the face", () => {
    const run = vi.fn();
    registerFaceReplay(ui, FACE.STROKE, run);
    expect(() => replayFace(ui, "poly1", FACE.STROKE)).not.toThrow();
  });
});
