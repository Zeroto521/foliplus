// Marker rendering: collect layer marker roots, then draw sprites, FontAwesome
// glyphs, text labels, and the remaining icon types (img, inline SVG, bg fill).
// Moved from renderer.ts — collectLayerMarkers, renderMarkers, renderFontAwesome,
// renderTextLabels, renderRemaining.
import * as CONST from "../const.js";
import { ensureFont, isVisible, loadImage, loadImageBitmap } from "../util.js";
import { type RenderCtx, effectiveOpacity, pooledEach, withAlpha } from "./util.js";

/** Collect markers belonging to a specific layer's panes. */
const collectLayerMarkers = (layer: L.Layer): HTMLElement[] => {
  const panes = map.foliplus!.LayerAPI!.getLayerPanes(layer);
  const roots: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const paneName of panes) {
    const pane = map.getPane(paneName);
    if (!pane) continue;
    for (let i = 0; i < pane.children.length; i++) {
      const el = pane.children[i] as HTMLElement;
      // Skip canvas and SVG — handled by dedicated render passes
      if (
        el.tagName === "CANVAS" ||
        el.tagName === "SVG" ||
        el.matches(CONST.SEL.SKIP_EXPORT) ||
        el.querySelector(CONST.SEL.SKIP_EXPORT) ||
        window.getComputedStyle(el).display === "none"
      ) {
        continue;
      }
      if (seen.has(el)) continue;
      seen.add(el);
      roots.push(el);
    }
  }
  return roots;
};

/** Render markers with background-image sprites. */
const renderMarkers = async (
  container: HTMLElement,
  rc: RenderCtx,
  markerRoots: HTMLElement[],
): Promise<HTMLElement[]> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  const drawableEls: HTMLElement[] = [];
  for (const root of markerRoots) {
    drawableEls.push(root);
    for (const sub of root.querySelectorAll("*")) {
      const scs = window.getComputedStyle(sub);
      if (
        scs.backgroundImage &&
        scs.backgroundImage.includes("url(") &&
        scs.backgroundImage !== "none"
      ) {
        drawableEls.push(sub as HTMLElement);
      }
    }
  }

  // Load unique sprites (once per URL) directly into a local map
  const spriteUrls = new Set<string>();
  for (const el of drawableEls) {
    const cs = window.getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (!bg || bg === "none") continue;
    const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (m && !m[1].startsWith("data:")) spriteUrls.add(m[1]);
  }
  const spriteMap = new Map<string, ImageBitmap>();
  await pooledEach<string, ImageBitmap>(
    [...spriteUrls],
    CONST.TILE_CONCURRENCY,
    async url => {
      const bitmap = await loadImageBitmap(url);
      if (bitmap) spriteMap.set(url, bitmap);
      return null;
    },
  );

  // Draw sprites; release their bitmaps even if drawing throws.
  try {
    for (const el of drawableEls) {
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
      const bg = cs.backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) continue;
      const sprite = spriteMap.get(m[1]);
      if (!sprite) continue;
      const bgs = cs.backgroundSize || "auto";
      const bgsParts = bgs.trim().split(/\s+/);
      let cssBgW: number;
      let cssBgH: number;
      if (bgs === "auto" || bgs === "auto auto") {
        cssBgW = sprite.width / (window.devicePixelRatio || 1);
        cssBgH = sprite.height / (window.devicePixelRatio || 1);
      } else if (bgs.includes("%")) {
        cssBgW = (w * (parseFloat(bgsParts[0]) || 100)) / 100;
        cssBgH = (h * (parseFloat(bgsParts[1] || bgsParts[0]) || 100)) / 100;
      } else {
        cssBgW = parseFloat(bgsParts[0]) || sprite.width;
        cssBgH = parseFloat(bgsParts[1] || bgsParts[0]) || sprite.height;
      }
      const ratioX = sprite.width / cssBgW;
      const ratioY = sprite.height / cssBgH;
      const bp = cs.backgroundPosition || "0 0";
      const bpParts = bp.trim().split(/\s+/);
      const sx = Math.abs(parseFloat(bpParts[0]) || 0) * ratioX;
      const sy = Math.abs(parseFloat(bpParts[1]) || 0) * ratioY;
      const sw = w * ratioX;
      const sh = h * ratioY;
      if (sx + sw > sprite.width || sy + sh > sprite.height) continue;
      withAlpha(ctx, effectiveOpacity(container, el), () => {
        try {
          ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
        } catch {
          /* skip */
        }
      });
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
      if (match2) iconText = String.fromCharCode(parseInt("f" + match2[1], 16));
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
    const textEl = (root.querySelector(CONST.SEL.LABEL) || root) as HTMLElement;
    const text = textEl.textContent || "";
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
 *  <img> → fallback sprite → inline SVG → background-color fill. */
const renderRemaining = async (
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

    const rootAlpha = effectiveOpacity(container, root);

    // 1. <img> elements (default Leaflet markers)
    const imgEl =
      root.tagName === "IMG" ? (root as HTMLImageElement) : root.querySelector("img");
    if (imgEl && imgEl.src) {
      let img: HTMLImageElement | null = null;
      let drawn = false;
      try {
        img = (await loadImage(imgEl.src, "anonymous")) as HTMLImageElement;
        drawn = true;
      } catch {
        /* fall through */
      } finally {
        if (img) {
          withAlpha(ctx, rootAlpha, () => {
            ctx.drawImage(img!, dx, dy, dw, dh);
          });
          drawn = true;
        }
      }
      if (drawn) continue;
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
        let src = new XMLSerializer().serializeToString(clone);
        if (!src.includes(`xmlns="${CONST.SVG_NS}"`)) {
          src = src.replace("<svg", `<svg xmlns="${CONST.SVG_NS}"`);
        }
        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const img = (await loadImage(url)) as HTMLImageElement;
          withAlpha(ctx, rootAlpha, () => {
            ctx.drawImage(img, dx, dy, dw, dh);
          });
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
          ctx.roundRect(dx, dy, dw, dh, br * scale);
          ctx.fill();
        } else ctx.fillRect(dx, dy, dw, dh);

        const bw = parseFloat(rootCS.borderWidth) || 0;
        if (bw > 0 && rootCS.borderStyle !== "none" && rootCS.borderColor) {
          ctx.strokeStyle = rootCS.borderColor;
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
  }
};

export {
  collectLayerMarkers,
  renderMarkers,
  renderFontAwesome,
  renderTextLabels,
  renderRemaining,
};
