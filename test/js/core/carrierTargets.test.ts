import { describe, expect, it } from "vitest";
import {
  type CarrierDecl,
  annotationPaneNameOf,
  carrierToken,
  contentPanesOf,
} from "#foliplus/core/carrierTargets.js";
import { ANNOTATION_PANE_PREFIX, CAP_TIER } from "#foliplus/core/layer/const.js";

const paneDecl = (panes: string[], extra: Partial<CarrierDecl> = {}): CarrierDecl => ({
  panes,
  opacityTier: CAP_TIER.PANE,
  ...extra,
});

describe("carrierToken", () => {
  it("keys a canvas face on the element itself", () => {
    const canvas = {} as HTMLCanvasElement;
    const token = carrierToken(paneDecl([], { canvas }));
    expect(token).toBe(canvas);
  });

  it("keys a pane carrier on its sorted pane set", () => {
    // Sorted so the order the pane specs happen to arrive in cannot register
    // as "the carrier moved" and force a rewrite.
    expect(carrierToken(paneDecl(["zeta", "alpha"]))).toBe("alpha|zeta");
    expect(carrierToken(paneDecl(["alpha", "zeta"]))).toBe("alpha|zeta");
  });

  it("keys a native carrier on the layer's own options object", () => {
    const options = { opacity: 1 };
    const layer = { options } as unknown as L.Layer;
    const token = carrierToken(
      paneDecl(["ignored"], {
        layer,
        opacityTier: CAP_TIER.NATIVE,
      }),
    );
    expect(token).toBe(options);
  });

  it("answers null when there is no carrier at all", () => {
    expect(carrierToken(paneDecl([], { opacityTier: CAP_TIER.NONE }))).toBeNull();
  });
});

describe("contentPanesOf", () => {
  it("drops every pane the shadow channel owns, keeping draw order", () => {
    const panes = ["base", "shadow-a", "sub", "shadow-b"];
    expect(contentPanesOf(panes, new Set(["shadow-a", "shadow-b"]))).toEqual([
      "base",
      "sub",
    ]);
  });

  it("returns an empty list for a surface that owns no pane", () => {
    expect(contentPanesOf([], new Set(["shadow-a"]))).toEqual([]);
  });
});

describe("annotationPaneNameOf", () => {
  it("composes the one pane name the declaration and the exporter share", () => {
    expect(annotationPaneNameOf("layer-1")).toBe(`${ANNOTATION_PANE_PREFIX}layer-1`);
    expect(annotationPaneNameOf("layer-1")).not.toBe(annotationPaneNameOf("layer-2"));
  });
});

describe("one declaration, two readers", () => {
  it("the writer's token names the same pane set the export walk covers", () => {
    // The projection executor keys its rewrite decision on the token; the
    // export renderer walks the content panes. Both take the same
    // declaration, so a write and an export cannot resolve different panes for
    // one layer — the reason this module exists.
    const decl = paneDecl(["p-sub", "p-base"]);
    const token = carrierToken(decl);
    const exported = contentPanesOf(decl.panes, new Set());

    expect(typeof token).toBe("string");
    expect((token as string).split("|")).toEqual([...exported].sort());
  });

  it("both readers ignore the same shadow panes", () => {
    const decl = paneDecl(["p-base", "p-shadow", "p-sub"]);
    const shadowPanes = new Set(["p-shadow"]);
    const token = carrierToken({
      ...decl,
      panes: contentPanesOf(decl.panes, shadowPanes),
    });
    expect(token).toBe("p-base|p-sub");
    expect(contentPanesOf(decl.panes, shadowPanes)).toEqual(["p-base", "p-sub"]);
  });
});
