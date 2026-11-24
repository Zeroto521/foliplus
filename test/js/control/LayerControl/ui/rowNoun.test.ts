// LayerControl ui/rowNoun — the row noun vocabulary and the {noun} substitution.
import { describe, expect, it } from "vitest";
import { ROW_NOUN, nounKey, withNoun } from "#control/LayerControl/ui/rowNoun.js";
import type { LayerUI } from "#control/LayerControl/ui/surface.js";

const ui = {
  T: (key: string) =>
    ({
      focus_tooltip: "Focus on this {noun}",
      focus_base: "Base map cannot be focused",
      noun_layer: "layer",
      noun_folder: "folder",
      noun_group: "layer group",
      noun_role: "section",
    })[key] ?? key,
} as unknown as LayerUI;

describe("LayerControl ui: withNoun", () => {
  it("fills the placeholder with the noun's own locale key", () => {
    expect(withNoun(ui, "focus_tooltip", ROW_NOUN.LAYER)).toBe("Focus on this layer");
    expect(withNoun(ui, "focus_tooltip", ROW_NOUN.FOLDER)).toBe("Focus on this folder");
    expect(withNoun(ui, "focus_tooltip", ROW_NOUN.GROUP)).toBe(
      "Focus on this layer group",
    );
  });

  it("returns a sentence without a placeholder unchanged", () => {
    expect(withNoun(ui, "focus_base", ROW_NOUN.LAYER)).toBe(
      "Base map cannot be focused",
    );
  });

  it("names every noun's locale key from the one vocabulary", () => {
    // A noun added to ROW_NOUN without a noun_<noun> locale entry would
    // otherwise surface as the raw key inside a sentence.
    for (const noun of Object.values(ROW_NOUN)) {
      expect(nounKey(noun)).toBe(`noun_${noun}`);
      expect(ui.T(nounKey(noun))).not.toBe(nounKey(noun));
    }
  });
});
