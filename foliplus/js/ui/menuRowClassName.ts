// ui/menuRowClassName — single source for the shared menu-row class name.
//
// Every row surface that carries the selection left-bar mechanism and the
// menu-row typography spells this one class: the LayerControl layer item, the
// ui/dropdown option row, the ui/schemePicker item (and the dropdown select-all
// row). css/common/row.css owns the declaration; this module owns the spelling
// so the surfaces cannot drift apart on the class string itself.
//
// Pure data — no runtime import, no map, no DOM — so any layer may import it.
const MENU_ROW_CLASS = {
  /** The shared menu-row chrome: left selection bar + row typography. */
  ROW: "foliplus-menu-row",
} as const;

export { MENU_ROW_CLASS };
