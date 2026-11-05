// LayerControl UI — inline glyph set for the icon dimension.
//
// 32 curated glyphs, each a 24x24 viewBox SVG. Contract:
//  - fill="currentColor" — the glyph paints from the outer container's
//    color (the author's iconColor / CSS var), never a hardcoded fill.
//  - single <path> preferred; legacy primitives (circle/rect/polygon)
//    keep their shapes where the path form would be a rewrite.
//  - These are PLAIN double-quote strings, NOT template literals.
//    The build's compress.mjs SVG pass only rewrites backtick template
//    literals, so plain strings are never SVGO-mangled (the stronger
//    guarantee than interpolating a currentColor var).
//
// GLYPH_ALIASES maps a legacy name to its modern equivalent;
// resolveGlyph falls back to the circle glyph for an unknown name.

const GLYPH_SETS = [
  {
    name: "circle",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>',
  },
  {
    name: "square",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>',
  },
  {
    name: "triangle",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,3 22,21 2,21"/></svg>',
  },
  {
    name: "diamond",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,12 12,22 2,12"/></svg>',
  },
  {
    name: "star",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9"/></svg>',
  },
  {
    name: "flag",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18h2v-7h10l-2-4 2-4H7V3z"/></svg>',
  },
  {
    name: "cross",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
  },
  {
    name: "map-pin",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
  },
  {
    name: "heart",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21S4 15.5 4 10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/></svg>',
  },
  {
    name: "tag",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 12l9-9h9v9l-9 9-9-9zm13-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  },
  {
    name: "plane",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 12l19-7-7 19-3-8-9-4z"/></svg>',
  },
  {
    name: "camera",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 7h3l1-2h8l1 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
  },
  {
    name: "rocket",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c3 2 4 6 4 9l3 5-4-1-1 3-2-2-2 2-1-3-4 1 3-5c0-3 1-7 4-9z"/></svg>',
  },
  {
    name: "check",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 12l6 6L20 6l-2-2-8 8-4-4z"/></svg>',
  },
  {
    name: "info",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>',
  },
  {
    name: "arrow-up",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 8h-5v12h-6V10H4z"/></svg>',
  },
  {
    name: "arrow-down",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22l-8-8h5V2h6v12h5z"/></svg>',
  },
  {
    name: "arrow-left",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12l-8-8v5H2v6h12v5z"/></svg>',
  },
  {
    name: "arrow-right",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 12l8-8v5h12v6H10v5z"/></svg>',
  },
  {
    name: "home",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 7h-2v10h-6v-6h-2v6H5V10H3z"/></svg>',
  },
  {
    name: "bell",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7v4l-2 4h18l-2-4V9a7 7 0 0 0-7-7zm-2 18a2 2 0 0 0 4 0z"/></svg>',
  },
  {
    name: "book",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3zm3.5 2v14H18V5H7.5z"/></svg>',
  },
  {
    name: "cloud",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 20a5 5 0 0 1-.5-10A6 6 0 0 1 17 8a4 4 0 0 1 1 8H6z"/></svg>',
  },
  {
    name: "envelope",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H4zm8 7.3L4 8.6V16h16V8.6l-8 4.7z"/></svg>',
  },
  {
    name: "fire",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-.5-2s4 2 4 6a6.5 6.5 0 0 1-13 0c0-4 3-5 3-8 0 0-1 1-1 3a3 3 0 0 0 3 3c1 0 2-1 2-2 0-2-2-4 .5-9z"/></svg>',
  },
  {
    name: "gear",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M18.3,10.3 21.9,10.6 21.9,13.4 18.3,13.7 16.6,16.6 18.2,19.9 15.7,21.3 13.7,18.3 10.3,18.3 8.3,21.3 5.8,19.9 7.4,16.6 5.7,13.7 2.1,13.4 2.1,10.6 5.7,10.3 7.4,7.4 5.8,4.1 8.3,2.7 10.3,5.7 13.7,5.7 15.7,2.7 18.2,4.1 16.6,7.4Z M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z"/></svg>',
  },
  {
    name: "leaf",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 20C4 9 11 4 20 4c0 9-5 16-16 16zm3-3c5-1 9-5 10-10-5 1-9 5-10 10z"/></svg>',
  },
  {
    name: "location",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 1.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15zM12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z"/></svg>',
  },
  {
    name: "music",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v12.5A3.5 3.5 0 1 1 7 12V6l10-2v11.5A3.5 3.5 0 1 1 15 15V5l-6 2z"/></svg>',
  },
  {
    name: "phone",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h3l1 5-2 1c1 3 3 5 6 6l1-2 5 1v3a2 2 0 0 1-2 2A17 17 0 0 1 4 4a2 2 0 0 1 2-2z"/></svg>',
  },
  {
    name: "tree",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l6 7h-3l4 5h-4l3 4H6l3-4H5l4-5H6z"/></svg>',
  },
  {
    name: "warning",
    svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2zm-1 6h2v7h-2V8zm0 9h2v2h-2v-2z"/></svg>',
  },
] as const;

const GLYPH_BY_NAME = new Map<string, string>(GLYPH_SETS.map(g => [g.name, g.svg]));

/** Legacy -> modern glyph-name alias (task-80: the old 8 geometric
 *  shapes keep their names for pass-through compat). */
const GLYPH_ALIASES: Record<string, string> = { pin: "map-pin" };

/** Resolve a glyph name to its SVG string, with a stable fallback. */
const resolveGlyph = (name: string): string =>
  GLYPH_BY_NAME.get(name) ??
  GLYPH_BY_NAME.get(GLYPH_ALIASES[name] ?? "") ??
  GLYPH_BY_NAME.get("circle")!;

export { GLYPH_SETS, resolveGlyph };
