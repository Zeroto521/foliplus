// LayerControl UI — the row noun vocabulary and the one {noun} substitution.
import type { LayerUI } from "./surface.js";

/** What a row's sentences call the thing they act on.
 *
 *  A folder row, a layer-group row and a plain layer row share every sentence
 *  (focus, rename, delete); only this noun differs. The sentences therefore
 *  carry a `{noun}` placeholder instead of being duplicated per kind, so a
 *  translation cannot drift into two formats for the same action.
 *
 *  The role header is not a row the user acts on, but its overflow button names
 *  its own object too ("{noun} options"), so it borrows the same vocabulary —
 *  its noun is `role`, never `section` (the vocabulary guard forbids a section
 *  middle-layer; the grouping is a role).
 *
 *  The vocabulary is a constant for the same reason `ROLE` is: a hand-rolled
 *  "group" at a call site would silently resolve to a missing locale key. */
const ROW_NOUN = {
  LAYER: "layer",
  FOLDER: "folder",
  GROUP: "group",
  /** The role header — the overlay/base grouping. Not "section": the repo's
   *  vocabulary guard forbids a section middle-layer, the grouping is a role. */
  ROLE: "role",
} as const;

/** A row noun — derived from `ROW_NOUN` so the runtime vocabulary stays a
 *  single source (a literal union here would drift from the constant). */
type RowNoun = (typeof ROW_NOUN)[keyof typeof ROW_NOUN];

/** The locale key that names a noun (`noun_layer` / `noun_folder` /
 *  `noun_group`). */
const nounKey = (noun: RowNoun): string => `noun_${noun}`;

/** Resolve a locale sentence that carries a `{noun}` placeholder.
 *
 *  The noun is itself a locale key, so a translation supplies both the
 *  sentence and the word that fills it — a language whose word order or
 *  article differs can move the placeholder freely. A sentence without the
 *  placeholder is returned as-is.
 *
 *  @param {LayerUI} ui - Layer UI (owns the translator).
 *  @param {string} key - Locale key carrying the sentence.
 *  @param {RowNoun} noun - Which thing the sentence is about.
 *  @returns {string} The resolved sentence. */
const withNoun = (ui: LayerUI, key: string, noun: RowNoun): string =>
  ui.T(key).replace("{noun}", ui.T(nounKey(noun)));

export { ROW_NOUN, nounKey, withNoun };
export type { RowNoun };
