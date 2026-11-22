// LayerControl UI — the row noun vocabulary and the one {noun} substitution.

import type { LayerUI } from "./surface.js";

/** What a row's sentences call the thing they act on.
 *
 *  A folder row, a layer-group row and a plain layer row share every sentence
 *  (focus, rename, delete); only this noun differs. The sentences therefore
 *  carry a `{noun}` placeholder instead of being duplicated per kind, so a
 *  translation cannot drift into two formats for the same action. */
type RowNoun = "layer" | "folder" | "group";

/** Resolve a locale sentence that carries a `{noun}` placeholder.
 *
 *  The noun is itself a locale key (`noun_layer` / `noun_folder` /
 *  `noun_group`), so a translation supplies both the sentence and the word
 *  that fills it — a language whose word order or article differs can move the
 *  placeholder freely. A sentence without the placeholder is returned as-is.
 *
 *  @param {LayerUI} ui - Layer UI (owns the translator).
 *  @param {string} key - Locale key carrying the sentence.
 *  @param {RowNoun} noun - Which thing the sentence is about.
 *  @returns {string} The resolved sentence. */
const withNoun = (ui: LayerUI, key: string, noun: RowNoun): string =>
  ui.T(key).replace("{noun}", ui.T(`noun_${noun}`));

export { withNoun };
export type { RowNoun };
