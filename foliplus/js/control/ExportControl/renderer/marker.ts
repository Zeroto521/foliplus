// Marker rendering: collect a layer's exportable roots (pane children and the
// leaves' own marker shadows), then draw sprites, FontAwesome glyphs, text
// labels, and the remaining icon types (img, inline SVG, bg fill).
// Moved from renderer.ts — collectPaneRoots, collectLayerShadows, renderMarkers,
// renderFontAwesome, renderTextLabels, renderRemaining.
//
// Scope of the marker-shadow channel, so nobody expects more from it than a
// canvas can deliver:
//   - it draws the leaf's own `_shadow` element, which Leaflet creates as an
//     <img> from the icon's `shadowUrl`.  Images that are same-origin or
//     served with CORS headers rasterise; a cross-origin shadow without CORS
//     cannot be read back into a canvas, so it is left out and reported (see
//     `renderRemaining`'s `onLoadError`).
//   - CSS effects on that element (`box-shadow`, `filter`, `mask`) are not
//     reproduced: the export rasterises the DOM's images, it does not emulate
//     a browser paint.  A DivIcon whose look is a CSS `box-shadow` with no
//     `shadowUrl` has no shadow at all — Leaflet creates no `_shadow` node, so
//     there is nothing to collect.
import * as CONST from "../const.js";
import type { RenderCtx } from "../type.js";
import {
  ensureFont,
  isExportExcluded,
  isVisible,
  loadImage,
  loadImageBitmap,
} from "../util.js";
import {
  effectiveOpacity,
  inlineSVGComputedStyles,
  noteAssetFailure,
  pooledEach,
  withAlpha,
} from "./util.js";
import { walkLeaf } from "#core/layer/index.js";
import { layerShadow } from "#core/leafletAdapter.js";

/** Whether a root element may be drawn — the export's single admission filter,
 *  shared by the pane sweep and the per-leaf shadow channel so both admit and
 *  reject exactly the same DOM.
 *
 *  Canvas and SVG roots belong to dedicated passes.  `isExportExcluded` covers
 *  the declarative opt-out (self or marked ancestor), the nested check drops a
 *  root that only *contains* a marked descendant (a root is drawn whole, never
 *  as a subtree), and the computed display drops what CSS hides.
 *
 *  The SVG test is on the namespace, not on `tagName`: an `<svg>` element lives
 *  in the SVG namespace, so an HTML document reports its tag name lowercase
 *  (`"svg"`) and `tagName === "SVG"` never matched — renderer roots were swept
 *  in as marker roots and painted a second time by the remaining-types pass.
 *  The namespace is realm-independent too (an svg inside an iframe's document
 *  still answers SVG_NS). */
const isAdmittedRoot = (el: HTMLElement): boolean =>
  el.tagName !== "CANVAS" &&
  el.namespaceURI !== CONST.SVG_NS &&
  !isExportExcluded(el) &&
  !el.querySelector(CONST.SEL.SKIP_EXPORT) &&
  window.getComputedStyle(el).display !== "none";

/** Collect the exportable roots of a set of panes. */
const collectPaneRoots = (paneNames: readonly string[]): HTMLElement[] => {
  const roots: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const paneName of paneNames) {
    const pane = map.getPane(paneName);
    if (!pane) continue;
    for (let i = 0; i < pane.children.length; i++) {
      const el = pane.children[i] as HTMLElement;
      if (!isAdmittedRoot(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      roots.push(el);
    }
  }
  return roots;
};

/** The pane a shadow element actually rides in, resolved from its real DOM
 *  ancestry — never from `options.shadowPane`.  A declared name is boilerplate
 *  (Leaflet's own default is `"shadowPane"` for every marker) and can collide
 *  with a content pane's name; excluding by declaration would then drop that
 *  whole content pane from every layer's walk.  The element's parent chain is
 *  the same fact this channel already trusts when it reads `layerShadow(leaf)`. */
const paneNameOf = (el: HTMLElement): string | null => {
  const panes = map.getPanes() as Record<string, HTMLElement | undefined>;
  for (let node = el.parentElement; node; node = node.parentElement) {
    for (const name of Object.keys(panes)) {
      if (panes[name] === node) return name;
    }
  }
  return null;
};

/** Collect one layer's marker-shadow roots — each leaf's own `_shadow` element
 *  — and record the pane names those shadows *actually* ride in.
 *
 *  The leaf is the source, not the pane.  A marker's shadow can be mounted in
 *  the layer's own shadow pane (#733), left in Leaflet's shared `shadowPane`
 *  (no per-layer carrier, or a pin that never ran), or sit in a custom pane
 *  several layers share — and the pane may even be empty while the shadow is
 *  still attached to its icon.  Reading `options.shadowPane` alone missed the
 *  first two and emptied the export's shadow channel on real maps; reading
 *  `layerShadow(leaf)` covers every case, and it keeps the channel per-layer:
 *  a shared pane is never swept wholesale, so another layer's shadows are not
 *  redrawn here.
 *
 *  `paneNames` is the export-wide accumulator.  A custom shadow pane can be
 *  shared by several layers, and no layer's content walk may paint that pane as
 *  content, so the names are collected across the whole export before any
 *  content pane is resolved (see `renderer/index`'s render()).  Each name is
 *  the shadow's real parent pane, added only for a shadow that was actually
 *  admitted: an excluded or hidden shadow cannot be mistaken for content
 *  anyway, because the content sweep runs the same admission filter. */
const collectLayerShadows = (layer: L.Layer, paneNames: Set<string>): HTMLElement[] => {
  const roots: HTMLElement[] = [];
  walkLeaf(layer, leaf => {
    const shadowEl = layerShadow(leaf);
    if (!shadowEl) return;
    if (!isAdmittedRoot(shadowEl)) return;
    roots.push(shadowEl);
    const paneName = paneNameOf(shadowEl);
    if (paneName) paneNames.add(paneName);
  });
  return roots;
};

/** The sprite URL a computed background/mask value carries, or null. */
const spriteUrlOf = (value: string | undefined): string | null => {
  if (!value || value === "none") return null;
  const match = value.match(/url\(["']?([^"')]+)["']?\)/);
  return match ? match[1] : null;
};

/** The custom-chassis paint channel: the sprite is a \`mask-image\` and the flat
 *  \`background-color\` is the paint. A preset chassis keeps the sprite in
 *  \`background-image\` instead, so this is the second sprite channel the marker
 *  DOM can paint a pin body with (a custom hex — see core/leaflet/markerIcon
 *  \`paintMountedChassis\`). The export has to know both, or a custom-coloured pin
 *  exports as its glyph only. */
const maskPaintOf = (
  cs: CSSStyleDeclaration,
): { url: string; color: string } | null => {
  const url = spriteUrlOf(
    cs.maskImage || (cs as { webkitMaskImage?: string }).webkitMaskImage,
  );
  const color = cs.backgroundColor;
  if (!url || !color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return null;
  }
  return { url, color };
};

/** One sprite-painted element: a plain \`background-image\` sprite, or a masked
 *  colour fill (the custom chassis) when \`mask\` is set. */
type SpriteTarget = {
  el: HTMLElement;
  url: string;
  mask: { url: string; color: string } | null;
};

/** The slice of the sprite sheet an element paints, from its CSS size/position.
 *  Shared by the background-image channel and the mask channel: the two differ
 *  in which CSS property carries the sprite, not in how the sheet is cropped.
 *  Null when the slice would fall outside the sheet (a stale offset). */
const spriteGeometryOf = (
  sprite: ImageBitmap,
  w: number,
  h: number,
  size: string,
  position: string,
): { sx: number; sy: number; sw: number; sh: number } | null => {
  const sizeParts = (size || "auto").trim().split(/\s+/);
  let cssW: number;
  let cssH: number;
  if (!size || size === "auto" || size === "auto auto") {
    const dpr = window.devicePixelRatio || 1;
    cssW = sprite.width / dpr;
    cssH = sprite.height / dpr;
  } else if (size.includes("%")) {
    cssW = (w * (parseFloat(sizeParts[0]) || 100)) / 100;
    cssH = (h * (parseFloat(sizeParts[1] || sizeParts[0]) || 100)) / 100;
  } else {
    cssW = parseFloat(sizeParts[0]) || sprite.width;
    cssH = parseFloat(sizeParts[1] || sizeParts[0]) || sprite.height;
  }
  const ratioX = sprite.width / cssW;
  const ratioY = sprite.height / cssH;
  const posParts = (position || "0 0").trim().split(/\s+/);
  const sx = Math.abs(parseFloat(posParts[0]) || 0) * ratioX;
  const sy = Math.abs(parseFloat(posParts[1]) || 0) * ratioY;
  const sw = w * ratioX;
  const sh = h * ratioY;
  if (sx + sw > sprite.width || sy + sh > sprite.height) return null;
  return { sx, sy, sw, sh };
};

/** Paint a sprite slice in one flat colour — the canvas equivalent of the DOM's
 *  \`mask-image\` + \`background-color\` pair. The sprite's alpha is the shape
 *  (\`source-in\` keeps only where it painted), the colour is the paint. */
const drawMaskedColor = (
  ctx: CanvasRenderingContext2D,
  sprite: ImageBitmap,
  slice: { sx: number; sy: number; sw: number; sh: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  color: string,
  alpha: number,
): void => {
  const sw = Math.max(1, Math.round(slice.sw));
  const sh = Math.max(1, Math.round(slice.sh));
  const scratch = document.createElement("canvas");
  scratch.width = sw;
  scratch.height = sh;
  const octx = scratch.getContext("2d");
  if (!octx) {
    // No 2D context (a host without raster support): keep the pin shape even
    // though the tint cannot be composed, rather than dropping the chassis.
    withAlpha(ctx, alpha, () => {
      ctx.drawImage(sprite, slice.sx, slice.sy, slice.sw, slice.sh, dx, dy, dw, dh);
    });
    return;
  }
  octx.drawImage(sprite, slice.sx, slice.sy, slice.sw, slice.sh, 0, 0, sw, sh);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = color;
  octx.fillRect(0, 0, sw, sh);
  withAlpha(ctx, alpha, () => {
    ctx.drawImage(scratch, 0, 0, sw, sh, dx, dy, dw, dh);
  });
};

/** Render markers with sprite paints: a plain \`background-image\` sprite (a
 *  preset chassis, an author icon) or a masked colour fill (a custom chassis
 *  hex). Both channels are collected here so the pin body is painted whichever
 *  way the DOM carries it. */
const renderMarkers = async (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
): Promise<HTMLElement[]> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  const targets: SpriteTarget[] = [];
  const collect = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    const cs = window.getComputedStyle(el);
    const mask = maskPaintOf(cs);
    const url = mask ? mask.url : spriteUrlOf(cs.backgroundImage);
    if (url) targets.push({ el, url, mask });
  };
  for (const root of markerRoots) {
    collect(root);
    for (const sub of root.querySelectorAll("*")) collect(sub);
  }

  // Load unique sprites (once per URL) directly into a local map
  const spriteUrls = new Set<string>();
  for (const { url } of targets) {
    if (!url.startsWith("data:")) spriteUrls.add(url);
  }
  const spriteMap = new Map<string, ImageBitmap>();
  await pooledEach<string, ImageBitmap>(
    [...spriteUrls],
    CONST.TILE_CONCURRENCY,
    async url => {
      const bitmap = await loadImageBitmap(url, error =>
        noteAssetFailure(rc, url, error),
      );
      if (bitmap) spriteMap.set(url, bitmap);
      return null;
    },
  );

  // Draw sprites; release their bitmaps even if drawing throws.
  try {
    for (const { el, url, mask } of targets) {
      const r = el.getBoundingClientRect();
      const l = r.left - contRect.left;
      const t = r.top - contRect.top;
      const w = r.width;
      const h = r.height;
      if (w < 1 || h < 1) continue;
      const dx = (l - rect.left) * scale;
      const dy = (t - rect.top) * scale;
      const dw = w * scale;
      const dh = h * scale;
      if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;
      const cs = window.getComputedStyle(el);
      const sprite = spriteMap.get(url);
      if (!sprite) continue;
      const size = mask ? cs.maskSize : cs.backgroundSize;
      const position = mask ? cs.maskPosition : cs.backgroundPosition;
      const slice = spriteGeometryOf(sprite, w, h, size, position);
      if (!slice) continue;
      const alpha = effectiveOpacity(container, el);
      if (mask) {
        drawMaskedColor(ctx, sprite, slice, dx, dy, dw, dh, mask.color, alpha);
      } else {
        withAlpha(ctx, alpha, () => {
          try {
            ctx.drawImage(
              sprite,
              slice.sx,
              slice.sy,
              slice.sw,
              slice.sh,
              dx,
              dy,
              dw,
              dh,
            );
          } catch {
            /* skip */
          }
        });
      }
    }
  } finally {
    // All sprites have been drawn (or aborted); release their bitmaps.
    for (const bitmap of spriteMap.values()) {
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
    }
  }
  return markerRoots;
};

/** Resolve a computed `border-radius` to device pixels for a draw box.
 *  Percentages resolve against the box (50% of a square is its circle);
 *  a computed shorthand ("8px 4px") uses its first component, which is the
 *  corner radius the marker pucks actually use. */
const radiusOf = (radius: string, dw: number, dh: number): number => {
  if (!radius) return 0;
  const first = radius.trim().split(/\s+/)[0] ?? "";
  if (first.endsWith("%")) {
    return (Math.min(dw, dh) * (parseFloat(first) || 0)) / 100;
  }
  return parseFloat(first) || 0;
};

/** Paint the flat background/border of marker roots AND their descendants.
 *
 *  A DivIcon's visible pin is arbitrary HTML: the root element Leaflet
 *  creates is transparent and the paint lives on a child (a `background`
 *  div, a bordered chip, ...). The remaining pass reads only the ROOT's
 *  background, so those markers exported nothing. This pass walks the whole
 *  icon subtree in document order (parent before child, the DOM's own paint
 *  order) and fills every element that carries a flat paint.
 *
 *  Each channel keeps its own painter: sprite paints (a background-image, or
 *  a mask+color chassis) belong to `renderMarkers`, label chrome to
 *  `renderTextLabels`, images and inline SVG to `renderRemaining`. The
 *  elements painted here are recorded on `rc.paintedBackgrounds` so the
 *  remaining pass does not fill them a second time (a second fill under a
 *  fractional alpha would deepen the paint). */
const renderIconBackgrounds = (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
): void => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  const painted = (rc.paintedBackgrounds ??= new WeakSet<HTMLElement>());
  for (const root of markerRoots) {
    if (root.matches(CONST.SEL.LABEL)) continue;
    const elements: HTMLElement[] = [root];
    for (const sub of root.querySelectorAll("*")) {
      if (!(sub instanceof HTMLElement)) continue;
      if (sub.namespaceURI === CONST.SVG_NS) continue;
      if (sub.closest(CONST.SEL.LABEL)) continue;
      elements.push(sub);
    }
    for (const el of elements) {
      if (isExportExcluded(el)) continue;
      const tag = el.tagName;
      if (tag === "IMG" || tag === "CANVAS" || tag === "SVG") continue;
      const cs = window.getComputedStyle(el);
      // Sprite paints are renderMarkers' channel — drawing the flat
      // background underneath would show through a transparent sprite.
      if (maskPaintOf(cs) || spriteUrlOf(cs.backgroundImage)) continue;
      const bgColor = cs.backgroundColor;
      if (!bgColor || bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const dx = (r.left - contRect.left - rect.left) * scale;
      const dy = (r.top - contRect.top - rect.top) * scale;
      const dw = r.width * scale;
      const dh = r.height * scale;
      if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;
      const alpha = effectiveOpacity(container, el);
      withAlpha(ctx, alpha, () => {
        ctx.save();
        ctx.fillStyle = bgColor;
        const br = radiusOf(cs.borderRadius, dw, dh);
        if (br > 0) {
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, br);
          ctx.fill();
        } else ctx.fillRect(dx, dy, dw, dh);

        const bw = parseFloat(cs.borderWidth) || 0;
        if (bw > 0 && cs.borderStyle !== "none" && cs.borderColor) {
          ctx.strokeStyle = cs.borderColor;
          ctx.lineWidth = bw * scale;
          if (br > 0) {
            ctx.beginPath();
            ctx.roundRect(dx, dy, dw, dh, br);
            ctx.stroke();
          } else ctx.strokeRect(dx, dy, dw, dh);
        }
        ctx.restore();
      });
      painted.add(el);
    }
  }
};

/** Render FontAwesome icons from ::before pseudo-element content. */
const renderFontAwesome = async (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
): Promise<void> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;

  for (const root of markerRoots) {
    const r = root.getBoundingClientRect();
    const l = r.left - contRect.left;
    const t = r.top - contRect.top;
    const w = r.width;
    const h = r.height;
    if (w < 1 || h < 1) continue;

    const dx = (l - rect.left) * scale;
    const dy = (t - rect.top) * scale;
    const dw = w * scale;
    const dh = h * scale;
    if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;

    const iconEl = root.querySelector("i");
    if (!iconEl) continue;
    const before = window.getComputedStyle(iconEl, "::before");
    const content = before.content;
    let iconText = "";
    if (content && content !== "none") {
      const raw = content.replace(/['"]/g, "");
      if (raw.length === 1) iconText = raw;
      const match = raw.match(/^\\([0-9a-fA-F]+)/);
      if (match) iconText = String.fromCharCode(parseInt(match[1], 16));
      const match2 = raw.match(/^\\\\f([0-9a-fA-F]+)/);
      if (match2) iconText = String.fromCharCode(parseInt(`f${match2[1]}`, 16));
    }

    const iconCS = window.getComputedStyle(iconEl);
    let fontSize = parseFloat(iconCS.fontSize) || 14;
    const fontFamily = iconCS.fontFamily || "FontAwesome";
    const color = iconCS.color || "#fff";
    let fontWeight = before.fontWeight || iconCS.fontWeight || "900";
    if (fontWeight === "normal") fontWeight = "400";
    if (fontWeight === "bold") fontWeight = "700";
    let iconDX = dx;
    let iconDY = dy;
    let iconDW = dw;
    let iconDH = dh;
    const ir = iconEl.getBoundingClientRect();
    const il = ir.left - contRect.left;
    const it = ir.top - contRect.top;
    if (ir.width > 0 && ir.height > 0) {
      iconDX = (il - rect.left) * scale;
      iconDY = (it - rect.top) * scale;
      iconDW = ir.width * scale;
      iconDH = ir.height * scale;
    }
    fontSize *= scale;
    const fontSpec = `${fontWeight} ${fontSize}px ${fontFamily}`;
    await ensureFont(fontSpec);
    withAlpha(ctx, effectiveOpacity(container, root), () => {
      ctx.save();
      ctx.font = fontSpec;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(iconText, iconDX + iconDW / 2, iconDY + iconDH / 2);
      ctx.restore();
    });
  }
};

/** Render plain text labels (e.g. MeasureControl distance labels) with background. */
const renderTextLabels = async (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
): Promise<void> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;

  for (const root of markerRoots) {
    const textEl = (root.querySelector(CONST.SEL.LABEL) ?? root) as HTMLElement;
    const text = textEl.textContent ?? "";
    if (!text.trim()) continue;
    if (root.querySelector("i")) continue;
    const rootCS = window.getComputedStyle(root);
    if (
      rootCS.backgroundImage &&
      rootCS.backgroundImage !== "none" &&
      rootCS.backgroundImage.includes("url(")
    ) {
      continue;
    }

    const textCS = window.getComputedStyle(textEl);
    const tr = textEl.getBoundingClientRect();
    const w = tr.width;
    const h = tr.height;
    if (w < 1 || h < 1) continue;
    const dx = (tr.left - contRect.left - rect.left) * scale;
    const dy = (tr.top - contRect.top - rect.top) * scale;
    const dw = w * scale;
    const dh = h * scale;
    if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;

    const textAlpha = effectiveOpacity(container, textEl);
    // Draw background from textEl's computed style.
    // backdrop-filter: blur() is a browser-only visual effect that cannot
    // be replicated on canvas.  Use the specified color as-is so the
    // export is deterministic and faithful to the CSS value.
    const bg = textCS.backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      withAlpha(ctx, textAlpha, () => {
        ctx.save();
        ctx.fillStyle = bg;
        const br = parseFloat(textCS.borderRadius) || 0;
        if (br > 0) {
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, br * scale);
          ctx.fill();
        } else ctx.fillRect(dx, dy, dw, dh);

        const bw = parseFloat(textCS.borderWidth) || 0;
        if (bw > 0 && textCS.borderStyle !== "none") {
          ctx.strokeStyle = textCS.borderColor || bg;
          ctx.lineWidth = bw * scale;
          if (br > 0) {
            ctx.beginPath();
            ctx.roundRect(dx, dy, dw, dh, br * scale);
            ctx.stroke();
          } else ctx.strokeRect(dx, dy, dw, dh);
        }
        ctx.restore();
      });
    }

    let fontSize = parseFloat(textCS.fontSize) || 14;
    const fontFamily = textCS.fontFamily || "sans-serif";
    const color = textCS.color || "#000";
    let fontWeight = textCS.fontWeight || "400";
    if (fontWeight === "normal") fontWeight = "400";
    if (fontWeight === "bold") fontWeight = "700";
    fontSize *= scale;
    const fontSpec = `${fontWeight} ${fontSize}px ${fontFamily}`;
    await ensureFont(fontSpec);
    withAlpha(ctx, textAlpha, () => {
      ctx.save();
      ctx.font = fontSpec;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      const cx = dx + dw / 2;
      const cy = dy + dh / 2;
      const lines = text.trim().split("\n");
      const lineHeight = fontSize * 1.2;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), cx, startY + i * lineHeight);
      }
      ctx.restore();
    });
  }
};

/** Render remaining icon types not handled by other passes:
 *  <img> → fallback sprite → inline SVG → background-color fill.
 *
 *  Geometry is measured immediately before each draw, never once at the top of
 *  the loop.  `render()` runs in the same task that hides the export chrome and
 *  forces a reflow (session.ts), so the browser may still hold a transient box:
 *  the first shadow pass measured a shadow pane at (-128,-72) and painted its
 *  shadow 256x144 canvas px away from the icon, which is exactly the "icon
 *  drawn, shadow missing" export.  Every branch below awaits something (an
 *  image load, an SVG blob load) and that await is when the layout settles —
 *  measuring again there makes the draw use the settled box.  The cheap
 *  pre-cull keeps an off-crop root from paying that load, and `render()` adds a
 *  frame barrier before the first pass so the pre-cull itself reads a settled
 *  box.  (SVG/bg-color roots have no load to hide behind: they measure right
 *  before their own draw.)
 *
 *  `onLoadError` is optional on purpose: an image that cannot be read back is
 *  not fatal (the branches below still try inline SVG / a background fill), but
 *  it must not be silent either.  The marker-shadow channel is where a missing
 *  image is a user-visible defect (a cross-origin shadow without CORS headers),
 *  so that caller passes a reporter and the icon channels do not. */
const renderRemaining = async (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
  onLoadError?: (src: string, error: unknown) => void,
): Promise<void> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;

  /** The draw-time box of a root, in canvas px. */
  const measure = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      dx: (r.left - contRect.left - rect.left) * scale,
      dy: (r.top - contRect.top - rect.top) * scale,
      dw: r.width * scale,
      dh: r.height * scale,
      w: r.width,
      h: r.height,
    };
  };

  /** A zero-area or off-crop box paints nothing. */
  const drawable = (g: ReturnType<typeof measure>): boolean =>
    g.w >= 1 && g.h >= 1 && isVisible(g.dx, g.dy, g.dw, g.dh, cw, ch);

  for (const root of markerRoots) {
    // Optimisation only: skip the load for a root that cannot draw.  The draw
    // itself re-measures below, so a stale pre-cull here can never decide the
    // painted coordinates.  This first box is also the one the background-fill
    // branch uses — it has no await between here and its fill.
    const initial = measure(root);
    if (!drawable(initial)) continue;

    const rootAlpha = effectiveOpacity(container, root);

    // 1. <img> elements (default Leaflet markers)
    const imgEl =
      root.tagName === "IMG" ? (root as HTMLImageElement) : root.querySelector("img");
    if (imgEl?.src) {
      let img: HTMLImageElement | null = null;
      try {
        img = (await loadImage(imgEl.src, "anonymous")) as HTMLImageElement;
      } catch (error) {
        // The branches below still run. The shadow channel passes its own
        // reporter (its message names the usual CORS cause); every other
        // icon is counted on the render context and reported once by the
        // renderer, so an unreadable icon is never a silent hole.
        if (onLoadError) onLoadError(imgEl.src, error);
        else noteAssetFailure(rc, imgEl.src, error);
      }
      if (img) {
        // The layout settled while the image loaded: this is the box the draw
        // must use, not the one the pre-cull saw.  A box that ended up outside
        // the crop needs no guard — the canvas clips the draw, and that is
        // exactly what the browser does for the same element.
        const g = measure(root);
        withAlpha(ctx, rootAlpha, () => {
          ctx.drawImage(img!, g.dx, g.dy, g.dw, g.dh);
        });
        continue;
      }
    }

    // 2. Elements with inline SVG (divIcon with html: '<svg>...</svg>')
    const svgEl = root.querySelector("svg");
    if (svgEl) {
      try {
        const clone = svgEl.cloneNode(true) as SVGElement;
        clone.removeAttribute("style");
        const sr = svgEl.getBoundingClientRect();
        clone.setAttribute("width", String(sr.width || 24));
        clone.setAttribute("height", String(sr.height || 24));
        const colorParent = svgEl.parentElement;
        const rootColor = colorParent ? window.getComputedStyle(colorParent).color : "";
        if (rootColor && rootColor !== "rgb(0, 0, 0)") {
          clone.setAttribute("color", rootColor);
        }
        // The clone becomes a standalone image with no stylesheet: a paint
        // that comes from a page CSS class must be written inline, or the
        // shape falls back to the default black fill.
        inlineSVGComputedStyles(svgEl, clone);
        let src = new XMLSerializer().serializeToString(clone);
        if (!src.includes(`xmlns="${CONST.SVG_NS}"`)) {
          src = src.replace("<svg", `<svg xmlns="${CONST.SVG_NS}"`);
        }
        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          let img: HTMLImageElement | null = null;
          try {
            img = (await loadImage(url)) as HTMLImageElement;
          } catch (error) {
            // A rasterisation failure is a real omission, not a fallback:
            // count it so it reaches the render stats and the console.
            noteAssetFailure(rc, svgEl.getAttribute("class") ?? "inline-svg", error);
          }
          if (img) {
            // Same draw-time measurement as the <img> branch: the blob load
            // is an await, and the layout may have settled during it.
            const g = measure(root);
            withAlpha(ctx, rootAlpha, () => {
              ctx.drawImage(img!, g.dx, g.dy, g.dw, g.dh);
            });
          }
        } finally {
          URL.revokeObjectURL(url);
        }
        continue;
      } catch {
        /* fall through */
      }
    }

    // 3. Elements with background-color but no background-image url (center dot)
    if (root.matches(CONST.SEL.LABEL)) continue;
    // The icon-background pass paints a root that carries a flat fill before
    // the glyph/text passes, so filling it again here would deepen the paint.
    if (rc.paintedBackgrounds?.has(root)) continue;
    // No await on this branch, so the pre-cull's box is still the current one;
    // reusing it keeps the fill and its border on the same measured geometry.
    const g = initial;
    const rootCS = window.getComputedStyle(root);
    const bgImg = rootCS.backgroundImage;
    const hasSprite = bgImg && bgImg !== "none" && bgImg.includes("url(");
    const bgColor = rootCS.backgroundColor;
    const hasBgColor =
      bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)";
    if (hasBgColor && !hasSprite && !root.querySelector(CONST.SEL.LABEL)) {
      withAlpha(ctx, rootAlpha, () => {
        ctx.save();
        ctx.fillStyle = bgColor;
        const br = parseFloat(rootCS.borderRadius) || 0;
        if (br > 0) {
          ctx.beginPath();
          ctx.roundRect(g.dx, g.dy, g.dw, g.dh, br * scale);
          ctx.fill();
        } else ctx.fillRect(g.dx, g.dy, g.dw, g.dh);

        const bw = parseFloat(rootCS.borderWidth) || 0;
        if (bw > 0 && rootCS.borderStyle !== "none" && rootCS.borderColor) {
          ctx.strokeStyle = rootCS.borderColor;
          ctx.lineWidth = bw * scale;
          if (br > 0) {
            ctx.beginPath();
            ctx.roundRect(g.dx, g.dy, g.dw, g.dh, br * scale);
            ctx.stroke();
          } else ctx.strokeRect(g.dx, g.dy, g.dw, g.dh);
        }
        ctx.restore();
      });
    }
  }
};

export {
  collectLayerShadows,
  collectPaneRoots,
  renderIconBackgrounds,
  renderMarkers,
  renderFontAwesome,
  renderTextLabels,
  renderRemaining,
};
