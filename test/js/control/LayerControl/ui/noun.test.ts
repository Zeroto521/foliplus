// test/js/control/LayerControl/ui/noun.test.ts — the {noun} substitution.
import { describe, expect, it } from "vitest";
import { withNoun } from "#control/LayerControl/ui/noun.js";

/** A translator that resolves from a table and echoes an unknown key. */
const translator = (table: Record<string, string>) =>
  ({ T: (key: string) => table[key] ?? key }) as never;

describe("LayerControl ui: withNoun", () => {
  it("fills the {noun} placeholder from the noun vocabulary", () => {
    const ui = translator({
      focus_tooltip: "Zoom to this {noun} and highlight it",
      noun_layer: "layer",
      noun_folder: "folder",
      noun_group: "layer group",
    });

    expect(withNoun(ui, "focus_tooltip", "layer")).toBe(
      "Zoom to this layer and highlight it",
    );
    expect(withNoun(ui, "focus_tooltip", "folder")).toBe(
      "Zoom to this folder and highlight it",
    );
    expect(withNoun(ui, "focus_tooltip", "group")).toBe(
      "Zoom to this layer group and highlight it",
    );
  });

  it("returns a sentence without a placeholder unchanged", () => {
    const ui = translator({
      focus_base: "Base map cannot be focused",
      noun_layer: "layer",
    });

    expect(withNoun(ui, "focus_base", "layer")).toBe("Base map cannot be focused");
  });
});
