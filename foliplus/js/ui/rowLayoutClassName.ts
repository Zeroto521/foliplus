// ui/rowLayoutClassName — single source for the shared row-primitive class names.
//
// The row primitive (ui/rowLayout.ts) builds `[leading][content][trailing]` rows
// that every pickable row surface converges on. Each token here has a declared
// owner (this file), so the class-owner guard can see it; consumers read the one
// spelling instead of spelling a bare literal. A consumer that only applies the
// classes via the builder never touches a literal at all.
//
// Pure data — no runtime import, no map, no DOM — so any layer may import it.
const ROW_CLASS = {
  ROW: "foliplus-row",
  LEADING: "foliplus-row-leading",
  CONTENT: "foliplus-row-content",
  TRAILING: "foliplus-row-trailing",
} as const;

export { ROW_CLASS };
