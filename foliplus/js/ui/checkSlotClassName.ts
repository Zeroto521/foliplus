// ui/checkSlotClassName — single source for the shared check-slot classes.
//
// A check slot is the leading indicator a row shows for a pickable item:
// a real <input type="checkbox"> the row paints its tri-state on. It is
// shared by every surface that lists picks — the multiple-mode dropdown
// select-all row, its option rows, and the scheme picker — so one DOM
// shape and one CSS module describe the indicator instead of each surface
// drawing its own glyph. One spelling here; every consumer reads it.
//
// Pure data — no runtime import, no DOM — so any layer may import it.
const CHECK_SLOT_CLASS = {
  /** The slot itself: a fixed-width leading cell so a row with and a row
   *  without an indicator keep the same label offset. */
  SLOT: "foliplus-check-slot",
  /** The checkbox the slot paints. A real input, so focus, keyboard and
   *  indeterminate all come from the platform rather than a drawn glyph. */
  BOX: "foliplus-check-slot-box",
} as const;

export { CHECK_SLOT_CLASS };
