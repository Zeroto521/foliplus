// ui/slider — horizontal slider primitive: one thumb or two, foliplus chrome, no deps.
//
// The widget owns the interaction model that native <input type=range> cannot
// express: a single control with two thumbs that never cross. Everything
// geometric is CSS (foliplus/css/slider.css); this module owns values, pointer and
// keyboard handling, and the ARIA contract.
//
// The value readout is NOT rendered inside the row: the bubble is a singleton
// portaled to <body> and positioned with fixed coordinates. A bubble inside
// the panel gets clipped by the panel body (and painted under its header) the
// moment the row sits near the panel's top edge — the reason this exists.
//
// Consumers place the root in a form row and drive map/style state from the
// callbacks; the exported sliderOf() gives a later pass (a reset, an external
// commit) access to the instance without re-rendering the row.
import { SLIDER_CLASS } from "./sliderClassName.js";
import type { SliderCurrent, SliderMark, SliderOptions, SliderValue } from "./type.js";
import { dom } from "#platform/dom.js";
import { finalize } from "#platform/finalize.js";
import { fullscreenSurface, onFullscreenSurfaceChange } from "#platform/fullscreen.js";
import { onGestureRetire } from "#platform/gesture.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("LayerControl");

/** One thumb (number) or a range (min/max pair). */
const INSTANCES = new WeakMap<HTMLElement, Slider>();

/** The slider rendered inside *host*, if any. */
const sliderOf = (host: Element | null): Slider | undefined =>
  host instanceof HTMLElement ? INSTANCES.get(host) : undefined;

/** Finish every live slider inside *root* (a panel about to be removed).
 *  Ending a session commits only when the pointer actually moved, so an
 *  untouched control does not gain a user override. */
const finishSlidersIn = (root: ParentNode): void => {
  root.querySelectorAll(`.${SLIDER_CLASS.ROOT}`).forEach(host => {
    if (host instanceof HTMLElement) INSTANCES.get(host)?.finish();
  });
};

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

// ── The value bubble ──────────────────────────────────────────────
// Bubbles are page-level and keyed by anchor (the thumb element): a row that
// owns one changes, the node does not. Keeping them out of every panel's
// overflow and stacking context is what made the readout disappear under the
// header. A single drag shows one bubble; a pan shows both thumbs at once, so
// the pool holds up to two live entries per slider — and an owner switch (a
// second slider takes over) hides the first slider's bubbles outright, so the
// live set never mixes two owners on one surface.
interface BubbleEntry {
  el: HTMLElement;
  owner: HTMLElement;
}
/** Live bubbles: anchor -> entry. Every entry is on screen (is-on). */
const bubbles = new Map<HTMLElement, BubbleEntry>();
/** Anchors hidden within the 150ms fade window, parked for reuse: a re-show
 *  cancels the timer and reuses the node instead of allocating a fresh one. */
const pendingHide = new Map<
  HTMLElement,
  { el: HTMLElement; owner: HTMLElement; timer: number }
>();
// One scroll listener for the whole page: bubbles are page-level, so a
// per-instance listener would leak one handler per slider the panels ever
// built. Registered when the first bubble is created.
let scrollBound = false;
let fullscreenBound = false;

/** The map container that owns *owner*. Scopes surface resolution to that map,
 *  so a bubble cannot land in a sibling map's pseudo container. */
const bubbleScope = (owner: Element | null): Element | null =>
  owner?.closest(".leaflet-container") ?? null;

/** Where a bubble lives: the covering surface of the owning map (native
 *  fullscreen element or pseudo-fullscreen container — only that subtree
 *  paints), otherwise <body>. */
const bubbleHost = (owner: HTMLElement): HTMLElement =>
  fullscreenSurface(bubbleScope(owner));

const bindFullscreen = (): void => {
  if (fullscreenBound) return;
  fullscreenBound = true;
  // Native fullscreen and pseudo enter/exit both announce through
  // platform/fullscreen. Pseudo mode only toggles a class and fires no DOM event,
  // so a `fullscreenchange` listener alone would leave the bubbles on <body>
  // under the opaque map.
  onFullscreenSurfaceChange(() => {
    // A bubble does not survive the transition: drop the live class now (the
    // fade plays) and re-seat every node — live or parked — onto its owner's
    // surface, so a node that was parked on the old surface follows it back.
    const live = [...bubbles.entries()];
    for (const [anchor, entry] of live) {
      const scope = bubbleScope(entry.owner);
      hideAnchor(anchor);
      const host = fullscreenSurface(scope);
      if (entry.el.parentElement !== host) host.appendChild(entry.el);
    }
    // Parked nodes (hidden within the fade window) also follow the surface:
    // they are invisible either way, but a re-show must not re-seat them onto
    // a stale host.
    for (const [, pending] of pendingHide) {
      const host = fullscreenSurface(bubbleScope(pending.owner));
      if (pending.el.parentElement !== host) host.appendChild(pending.el);
    }
  });
};

const createBubbleEl = (): HTMLElement => {
  const el = dom.el("div", {
    class: SLIDER_CLASS.BUBBLE,
    "aria-hidden": "true",
  });
  el.hidden = true;
  return el;
};

/** Show (or refresh) the bubble anchored at *anchor*, owned by *owner*. The
 *  caller sets the text and class after; this only guarantees the node exists
 *  on the right surface, cancels any pending hide, and clears any other
 *  owner's live bubbles (one slider shows bubbles at a time). */
const showAnchor = (anchor: HTMLElement, owner: HTMLElement): BubbleEntry => {
  bindFullscreen();
  if (!scrollBound) {
    scrollBound = true;
    // Any scroll moves the anchored value away from the pointer; every live
    // bubble is dismissed (each is viewport-fixed to its anchor).
    window.addEventListener(
      "scroll",
      () => {
        for (const [a] of bubbles) hideAnchor(a);
      },
      true,
    );
  }
  // Owner switch: another slider wants the surface, so this slider's live
  // bubbles go away immediately (their anchors no longer belong to it).
  for (const [otherAnchor, other] of bubbles) {
    if (other.owner !== owner) hideAnchor(otherAnchor, true);
  }
  const live = bubbles.get(anchor);
  if (live) {
    live.owner = owner;
    return live;
  }
  const pending = pendingHide.get(anchor);
  let el: HTMLElement;
  if (pending) {
    clearTimeout(pending.timer);
    pendingHide.delete(anchor);
    el = pending.el;
  } else {
    el = createBubbleEl();
  }
  el.hidden = false;
  const host = bubbleHost(owner);
  if (el.parentElement !== host) host.appendChild(el);
  const entry: BubbleEntry = { el, owner };
  bubbles.set(anchor, entry);
  return entry;
};

/** Hide the bubble at *anchor*. The live class drops immediately so the CSS
 *  fade plays (the node stays in the DOM, hidden still false); after 150ms
 *  the node is hidden and detached. With *immediate* the node is detached now
 *  (owner switch, fullscreen, destroy — no fade needed). Either way a re-show
 *  inside the fade window cancels the timer and reuses the node. */
const hideAnchor = (anchor: HTMLElement, immediate = false): void => {
  const entry = bubbles.get(anchor);
  if (!entry) return;
  bubbles.delete(anchor);
  entry.el.classList.remove("is-on");
  let timer = 0;
  const detach = (): void => {
    entry.el.hidden = true;
    entry.el.remove();
    const pending = pendingHide.get(anchor);
    if (pending?.timer === timer) pendingHide.delete(anchor);
  };
  if (immediate) {
    detach();
    return;
  }
  timer = window.setTimeout(detach, 150);
  pendingHide.set(anchor, { el: entry.el, owner: entry.owner, timer });
};

/** Keep the bubble inside the viewport and pointing at *anchor*: above it
 *  when there is room, below otherwise, shifted horizontally so an edge thumb
 *  does not push it off-screen. */
const placeBubble = (anchor: DOMRect, bubble: HTMLElement): void => {
  // Same distance Web Awesome uses between the control and its tooltip: the
  // arrow (4px of it) spans part of the gap, leaving the tip just clear of
  // the thumb instead of touching it.
  const margin = 8;
  const rect = bubble.getBoundingClientRect();
  const centre = anchor.left + anchor.width / 2;
  const half = Math.max(rect.width / 2, 8);
  const left = clamp(centre, half + margin, window.innerWidth - half - margin);
  // "Above" is the bubble's *bottom* edge, because the transform pulls the
  // box up by its own height; subtracting the height here as well would
  // double-count it and leave the bubble a bubble-height too high.
  const aboveBottom = anchor.top - margin;
  const belowTop = anchor.bottom + margin;
  const flip = aboveBottom - rect.height < margin;
  bubble.style.transform = flip ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  bubble.style.left = `${left}px`;
  bubble.style.top = `${flip ? belowTop : aboveBottom}px`;
  bubble.dataset.side = flip ? "below" : "above";
  // The arrow follows the thumb, not the bubble's centre: at the rail's ends
  // the clamped bubble would otherwise point at nothing.
  bubble.style.setProperty("--foliplus-bubble-arrow", `${centre - left}px`);
};

class Slider {
  readonly root: HTMLElement;
  private readonly opts: SliderOptions;
  private readonly range: boolean;
  private readonly values: number[];
  private readonly track: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly marksLayer: HTMLElement;
  private readonly valuesRow: HTMLElement;
  private readonly thumbs: HTMLElement[] = [];
  private dotEls: HTMLElement[] = [];
  private currentEl: HTMLElement | null = null;
  private disabled: boolean;
  private rtl: boolean;
  private bubbleFrame = 0;
  /** Thumbs whose bubble is shown and owned by this root. */
  private readonly bubbleAnchors = new Set<HTMLElement>();
  /** Releases the page-level gesture interrupt subscription. */
  private unsubscribeRetire: (() => void) | null = null;
  /** Whether the root has ever been in the document. A row is built detached
   *  and mounted a moment later; only a root that was mounted and then left is
   *  a dropped row. */
  private everConnected = false;
  /** Set when an interrupt ended the gesture; cleared by real input.
   *
   *  Coming back to the page re-fires `focus` at the element the browser
   *  restores, and the element's own `blur` on the way out cannot be used to
   *  tell the difference (the browser delivers it too, so a marker set on
   *  deactivation is always cleared again). The reliable rule is the user's:
   *  after an interruption nothing paints the readout until they actually
   *  touch the control — a pointer press or a key. */
  private interrupted = false;
  private drag: {
    id: number;
    index: number;
    dirty: boolean;
    /** A pan translates both thumbs; a single drag moves one. */
    pan?: boolean;
    /** Pan capture: the press position and the pair as it was. */
    startClientX?: number;
    startValues?: [number, number];
  } | null = null;

  constructor(host: HTMLElement, options: SliderOptions) {
    this.opts = {
      step: 1,
      format: (value: number) => String(Math.round(value)),
      ...options,
    };
    this.disabled = options.disabled ?? false;
    this.rtl = getComputedStyle(host).direction === "rtl";
    // Rows are built detached and mounted by the panel right after, so the
    // read above only sees an ancestor direction once the host is connected.
    // Re-read on the first frame after mounting; refreshDirection() covers
    // later changes.
    if (!host.isConnected) {
      requestAnimationFrame(() => {
        if (this.root.isConnected) this.refreshDirection();
      });
    }
    const initial = options.value;
    const pair = Array.isArray(initial) ? initial : null;
    this.range = pair !== null;
    // The constructor is a write path too: normalize like setValue so an
    // out-of-range or fractional initial value cannot paint past the rail or
    // invert the ARIA bounds.
    const normalize = (value: number): number =>
      Number.isFinite(value)
        ? this.round(clamp(value, options.min, options.max))
        : options.min;
    this.values = (pair ?? [initial as number]).map(normalize);
    if (this.range) this.values.sort((a, b) => a - b);

    this.root = host;
    host.classList.add(SLIDER_CLASS.ROOT);
    host.dataset.mode = this.range ? "range" : "single";
    if (this.range) {
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", this.opts.label);
    }

    this.track = dom.el("div", { class: SLIDER_CLASS.TRACK });
    this.rail = dom.el("div", { class: SLIDER_CLASS.RAIL });
    this.fill = dom.el("div", { class: SLIDER_CLASS.FILL });
    this.rail.appendChild(this.fill);
    this.marksLayer = dom.el("div", { class: SLIDER_CLASS.MARKS });
    this.valuesRow = dom.el("div", { class: SLIDER_CLASS.VALUES });
    this.track.append(this.rail, this.marksLayer);

    this.values.forEach((_, index) => {
      const thumb = dom.el("div", {
        class: SLIDER_CLASS.THUMB,
        role: "slider",
        tabindex: "0",
        "data-index": String(index),
        "aria-orientation": "horizontal",
        "aria-label": this.range
          ? (this.opts.labels?.[index] ?? `${this.opts.label} ${index + 1}`)
          : this.opts.label,
      });
      this.thumbs.push(thumb);
      this.track.appendChild(thumb);
    });

    host.append(this.track, this.valuesRow);
    INSTANCES.set(host, this);

    this.renderValues();
    this.renderMarks();
    this.bind();
    this.sync();
    this.applyAria();
  }

  // ── Public API ──────────────────────────────────────────────
  get value(): SliderValue {
    return this.range ? ([...this.values] as [number, number]) : this.values[0];
  }

  /** Set the value(s) from outside (a reset, another control). */
  setValue(value: SliderValue, options: { silent?: boolean } = {}): void {
    const next = Array.isArray(value) ? [...value] : [value];
    let changed = false;
    this.values.forEach((current, index) => {
      const raw = next[index];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const rounded = this.round(raw);
        if (rounded !== current) {
          this.values[index] = rounded;
          changed = true;
        }
      }
    });
    // The drag callback already synced the row before it reached the store;
    // echoing the same value back through setValue must not re-render it.
    if (!changed) return;
    this.normalizeOrder();
    this.sync();
    if (!options.silent) this.emit("input");
  }

  /** Replace the rail's dots. A row that re-syncs on every drag frame calls
   *  this with the same marks; rebuilding them each time would churn the DOM
   *  and drop the coverage classes for a frame. */
  setMarks(marks: SliderMark[]): void {
    const prev = this.opts.marks ?? [];
    const same =
      prev.length === marks.length &&
      marks.every((mark, index) => {
        const before = prev[index];
        return (
          before?.at === mark.at && (before?.tone ?? "limit") === (mark.tone ?? "limit")
        );
      });
    if (same) return;
    this.opts.marks = marks;
    this.renderMarks();
    this.sync();
  }

  /** Same idempotence for the "where am I" readout: a map zoom that did not
   *  move the level must not rebuild the label. */
  setCurrent(current: SliderCurrent | null): void {
    const prev = this.opts.current;
    if (!prev && !current) return;
    if (
      prev?.at === current?.at &&
      prev?.text === current?.text &&
      (prev?.hideGapPct ?? 0) === (current?.hideGapPct ?? 0)
    ) {
      return;
    }
    this.opts.current = current;
    this.renderCurrent();
    this.sync();
  }

  /** Make the control inert (or live again) without rebuilding it. */
  setDisabled(disabled: boolean): void {
    if (this.disabled === disabled) return;
    this.disabled = disabled;
    if (disabled) {
      // A disabled control must not keep applying a live drag: commit what the
      // pointer already produced, then drop the session so no move lands.
      this.endSession(true);
      this.hideBubble();
    }
    this.applyAria();
  }

  setDescribedBy(id: string | undefined): void {
    this.opts.describedBy = id;
    this.applyAria();
  }

  /** Re-read the inline direction. Constructor-time detection covers a static
   *  page; this covers a `dir` switch made after the row rendered. */
  refreshDirection(): void {
    this.rtl = getComputedStyle(this.root).direction === "rtl";
    this.sync();
  }

  /** Announce the current value as settled. For a caller that wrote a value
   *  programmatically (a reset, a test) and needs the persistence path to run
   *  the way a pointer release would. */
  commit(): void {
    this.emit("change");
  }

  /** Finish a live drag as a commit. Safe when nothing is in flight: the
   *  session only emits when the pointer actually moved. */
  finish(): void {
    this.endSession(true);
  }

  /** Drop the bubbles if this slider owns them (teardown path). */
  dismissBubble(): void {
    this.hideBubble();
  }

  /** Mirror the ARIA state onto the thumbs and the group. */
  private applyAria(): void {
    this.root.classList.toggle(SLIDER_CLASS.DISABLED, this.disabled);
    const described = this.opts.describedBy;
    this.thumbs.forEach(thumb => {
      thumb.tabIndex = this.disabled ? -1 : 0;
      thumb.setAttribute("aria-disabled", this.disabled ? "true" : "false");
      if (described) thumb.setAttribute("aria-describedby", described);
      else thumb.removeAttribute("aria-describedby");
    });
    if (this.range) {
      if (described) this.root.setAttribute("aria-describedby", described);
      else this.root.removeAttribute("aria-describedby");
    }
  }

  destroy(): void {
    finalize(
      [
        // The page-level interrupt subscription is per instance; drop it so a
        // removed slider cannot be called back by a later blur.
        [
          "release-retire",
          () => {
            this.unsubscribeRetire?.();
            this.unsubscribeRetire = null;
          },
        ],
        // Destroy commits rather than discards: the dragged value is the
        // user's, and the map, persistence and panel already show it. Dropping
        // it here would make a removal silently undo their last gesture. Same
        // rule as `retireRow`.
        ["commit-drag", () => this.endSession(true)],
        [
          "hide-bubble",
          () => {
            this.hideBubble(undefined, true);
          },
        ],
        [
          "deregister",
          () => {
            INSTANCES.delete(this.root);
          },
        ],
        ["clear-children", () => this.root.replaceChildren()],
        ["clear-class", () => this.root.classList.remove(SLIDER_CLASS.ROOT)],
        ["clear-role", () => this.root.removeAttribute("role")],
        ["clear-label", () => this.root.removeAttribute("aria-label")],
        ["clear-mode", () => this.root.removeAttribute("data-mode")],
      ],
      failure => log.warn(`slider destroy step "${failure.name}" threw`, failure.error),
    );
  }

  // ── Geometry ────────────────────────────────────────────────
  private pct(value: number): number {
    const span = this.opts.max - this.opts.min;
    return span <= 0 ? 0 : ((value - this.opts.min) / span) * 100;
  }

  /** The percentage as a left offset: mirrored in RTL, because the rail's
   *  start is its right edge there. Keeps every mark and the fill on one
   *  mapping. */
  private visualPct(value: number): number {
    const pct = this.pct(value);
    return this.rtl ? 100 - pct : pct;
  }

  private round(value: number): number {
    const { min, max, step = 1 } = this.opts;
    const snapped = min + Math.round((value - min) / step) * step;
    return clamp(snapped, min, max);
  }

  /** Keep an externally written pair in order. */
  private normalizeOrder(): void {
    if (!this.range) return;
    if (this.values[0] > this.values[1]) {
      const lower = this.values[1];
      this.values[1] = this.values[0];
      this.values[0] = lower;
    }
  }

  /** Write one thumb's value.
   *
   *  A thumb cannot cross the other one. Two cases:
   *  - a normal range clamps at the neighbour (dragging min past max stops);
   *  - a collapsed pair (both thumbs on one value) slides as one, because
   *    clamping there would leave the value unable to move in one direction —
   *    the exact behaviour the old two-input slider could not express. */
  private applyValue(index: number, next: number): void {
    if (!this.range) {
      this.values[0] = next;
      return;
    }
    const collapsed = this.values[0] === this.values[1];
    const crossing = index === 0 ? next > this.values[1] : next < this.values[0];
    if (!crossing) {
      this.values[index] = next;
      return;
    }
    if (collapsed) {
      const moved = clamp(next, this.opts.min, this.opts.max);
      this.values[0] = moved;
      this.values[1] = moved;
      return;
    }
    this.values[index] = index === 0 ? this.values[1] : this.values[0];
  }

  // ── Rendering ───────────────────────────────────────────────
  private renderValues(): void {
    this.valuesRow.replaceChildren();
    if (!this.opts.values) return;
    this.valuesRow.append(
      dom.el("span", { class: SLIDER_CLASS.VALUE_MIN }, this.opts.values.min),
      dom.el("span", { class: SLIDER_CLASS.VALUE_MAX }, this.opts.values.max),
    );
    this.renderCurrent();
  }

  private renderCurrent(): void {
    this.currentEl?.remove();
    this.currentEl = null;
    const current = this.opts.current;
    if (!current || !this.opts.values) return;
    const label = dom.el("span", { class: SLIDER_CLASS.VALUE_CURRENT }, current.text);
    this.currentEl = label;
    this.valuesRow.appendChild(label);
  }

  private renderMarks(): void {
    this.marksLayer.replaceChildren();
    this.dotEls = (this.opts.marks ?? []).map(mark => {
      const dot = dom.el("span", {
        class:
          SLIDER_CLASS.DOT +
          (mark.tone === "current" ? ` ${SLIDER_CLASS.DOT_CURRENT}` : ""),
        "data-at": String(mark.at),
        "aria-hidden": "true",
      });
      this.marksLayer.appendChild(dot);
      return dot;
    });
  }

  private sync(): void {
    this.thumbs.forEach((thumb, index) => {
      const value = this.values[index];
      thumb.style.left = `${this.visualPct(value)}%`;
      thumb.setAttribute(
        "aria-valuemin",
        String(this.range && index === 1 ? this.values[0] : this.opts.min),
      );
      thumb.setAttribute(
        "aria-valuemax",
        String(this.range && index === 0 ? this.values[1] : this.opts.max),
      );
      thumb.setAttribute("aria-valuenow", String(value));
      thumb.setAttribute("aria-valuetext", this.opts.format?.(value) ?? String(value));
    });

    // A single thumb covers [min, value]; a range covers [min, max]. The end
    // dots report that coverage, so the opacity row's 0 end is accent from
    // the start (the layer is painted from 0) and its 100 end is accent only
    // at full opacity.
    const lo = this.range ? this.values[0] : this.opts.min;
    const hi = this.values[this.values.length - 1];
    const start = this.visualPct(lo);
    const end = this.visualPct(hi);
    this.fill.style.left = `${Math.min(start, end)}%`;
    this.fill.style.width = `${Math.abs(end - start)}%`;

    // Cached nodes: a drag re-syncs on every pointermove, and re-querying the
    // layer each frame is the one avoidable DOM read on that path.
    for (const dot of this.dotEls) {
      const at = Number(dot.dataset.at);
      dot.style.left = `${this.visualPct(at)}%`;
      dot.classList.toggle(SLIDER_CLASS.DOT_COVERED, at >= lo && at <= hi);
    }

    if (this.currentEl && this.opts.current) {
      const current = this.opts.current;
      this.currentEl.style.left = `${this.visualPct(current.at)}%`;
      const gap = current.hideGapPct ?? 0;
      const nearEnd =
        gap > 0 && (this.pct(current.at) < gap || this.pct(current.at) > 100 - gap);
      this.currentEl.classList.toggle(SLIDER_CLASS.LABEL_HIDDEN, nearEnd);
    }

    this.updateBubbles();
  }

  // ── Interaction ─────────────────────────────────────────────
  private bind(): void {
    // A release only reaches a focused page, so the in-app endings above
    // cannot cover an alt-tab or a tab switch. `retire` is the one teardown
    // every out-of-band ending runs: it ends the drag (committing what the
    // pointer already produced) and clears this slider's bubbles.
    this.unsubscribeRetire = onGestureRetire(this.retire);
    this.track.addEventListener("pointerdown", this.onTrackDown);
    this.track.addEventListener("pointermove", this.onPointerMove);
    this.track.addEventListener("pointerup", this.onPointerUp);
    this.track.addEventListener("pointercancel", this.onPointerUp);
    this.track.addEventListener("pointerleave", () => {
      // A pan holds pointer capture, so a leave mid-drag is not the pointer
      // leaving the segment; only the idle hover cursor clears here.
      if (!this.drag) this.track.classList.remove(SLIDER_CLASS.CAN_PAN);
    });
    this.track.addEventListener("lostpointercapture", this.onLostCapture);
    this.thumbs.forEach((thumb, index) => {
      thumb.addEventListener("pointerdown", event => this.onThumbDown(event, index));
      thumb.addEventListener("keydown", event => this.onKeyDown(event, index));
      thumb.addEventListener("focus", () => this.onThumbFocus(index));
      thumb.addEventListener("blur", () => this.hideBubble(index));
    });
  }

  private readonly onTrackDown = (event: PointerEvent): void => {
    if (this.disabled) return;
    if (event.button !== undefined && event.button !== 0) return;
    // A press in the segment between the thumbs pans the pair; anywhere else
    // on the rail still moves the nearer thumb as before.
    if (this.range && this.hitFill(event.clientX)) {
      this.beginPan(event);
      return;
    }
    this.begin(event, this.pickThumb(event.clientX), false);
  };

  private readonly onThumbDown = (event: PointerEvent, index: number): void => {
    if (this.disabled) return;
    if (event.button !== undefined && event.button !== 0) return;
    // The track's own listener would run too; one begin per press.
    event.stopPropagation();
    // A stacked pair is grabbable on either half: the start-side half takes
    // the lower thumb, the other the upper one. Pressing the top thumb
    // unconditionally would make the lower one unreachable.
    this.begin(
      event,
      this.isOverlapping() ? this.pickThumb(event.clientX) : index,
      true,
    );
  };

  /** A focus shows the readout the user is asking for — except in the wake of
   *  an interrupt, where a focus can be the browser restoring the page rather
   *  than the user asking for a value. Real input (a press, a key) clears the
   *  marker first, so this only swallows the automatic one. */
  private onThumbFocus(index: number): void {
    if (this.interrupted) return;
    this.showBubble(index);
  }

  private begin(event: PointerEvent, index: number, fromThumb: boolean): void {
    // One session at a time: a second finger must not overwrite the first
    // one's drag, or the first release would find nothing to commit.
    if (this.drag) return;
    // A press is real input: the control may show its readout again.
    this.interrupted = false;
    event.preventDefault();
    this.drag = { id: event.pointerId, index, dirty: false };
    try {
      this.track.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimisation; the element listeners still fire.
    }
    this.thumbs[index].classList.add(SLIDER_CLASS.DRAGGING);
    this.thumbs[index].focus({ preventScroll: true });
    // A press on a stacked pair is ambiguous and waits for the first movement:
    // applying the press position would move one thumb off the stack and turn
    // the intended pair-slide into a clamp. A press on the rail is not
    // ambiguous — it moves the nearest thumb at once.
    if (!fromThumb || !this.isOverlapping()) {
      this.setFromClientX(event.clientX, index);
    }
    this.showBubble(index);
  }

  /** Start a pan: a press in the segment between the thumbs grabs the whole
   *  range. The pair is captured as it was and every later move applies the
   *  same delta to both, so the width never changes. */
  private beginPan(event: PointerEvent): void {
    if (this.drag) return;
    event.preventDefault();
    this.drag = {
      id: event.pointerId,
      index: 0,
      dirty: false,
      pan: true,
      startClientX: event.clientX,
      startValues: [this.values[0], this.values[1]],
    };
    try {
      this.track.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimisation; the element listeners still fire.
    }
    // The whole segment is the grab region: mark the track (not the fill,
    // which stays pointer-events: none) so the cursor reads grabbing and the
    // fill transition is disabled while the pan runs. A pan moves the pair,
    // so neither thumb is focused, but both bubbles are shown — the user
    // needs to see both values move as the range slides.
    this.track.classList.add(SLIDER_CLASS.IS_PANNING);
    this.track.classList.remove(SLIDER_CLASS.CAN_PAN);
    this.showBubble(0);
    this.showBubble(1);
  }

  /** Close the live pointer session: release the drag flag and the thumb's
   *  visual state, and commit the last value when the drag actually moved. */
  private endSession(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    // A pan marks the track; a single drag marks only the active thumb.
    if (drag.pan) {
      this.track.classList.remove(SLIDER_CLASS.IS_PANNING);
      this.hideBubble();
    } else {
      this.thumbs[drag.index]?.classList.remove(SLIDER_CLASS.DRAGGING);
      this.hideBubble();
    }
    if (commit && drag.dirty) this.emit("change");
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Explicit null check, not `!== this.drag?.id`: both sides are undefined
    // for a synthetic mouse event and a missing drag would pass that compare.
    const drag = this.drag;
    if (!drag) {
      // No session: show a grab cursor while the pointer sits in the pan
      // segment, pointer elsewhere. One hit test drives both the press and
      // the cursor, so a press and the cursor can never disagree.
      this.updateTrackCursor(event.clientX);
      return;
    }
    if (event.pointerId !== drag.id) return;
    if (drag.pan) this.panByClientX(event.clientX);
    else this.setFromClientX(event.clientX, drag.index);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (event.pointerId !== drag.id) return;
    try {
      this.track.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    this.endSession(true);
    this.updateTrackCursor(event.clientX);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    // A stray capture loss from another pointer must not end this session.
    if (event.pointerId !== drag.id) return;
    // A lost capture (alt-tab, context menu, a browser gesture) ends the drag
    // without a pointerup; the value already moved, so it still has to be
    // committed or the map would keep a preview the store never recorded.
    this.endSession(true);
  };

  /** The teardown for an ending no release describes: the window lost focus,
   *  the tab went hidden, or the pointer was cancelled outside this track.
   *
   *  Everything the normal path would have reset is reset here through the
   *  same calls — the drag session (which commits what the pointer already
   *  produced, like the capture-loss path) and this slider's bubbles. It is
   *  idempotent by construction: `endSession` returns early with no live
   *  session and `hideBubble()` skips anchors that are no longer pooled, so
   *  a blur followed by a visibilitychange, or an interrupt after the user
   *  already released, is harmless.
   *
   *  A cancel that names a different pointer belongs to another gesture and
   *  leaves the live session alone. */
  private readonly retire = (event: Event): void => {
    // A row whose panel was dropped without calling destroy() is no longer
    // anybody's: release the subscription here rather than waiting for GC, so
    // the page-level set cannot grow by one entry per panel the user opened.
    // A root that was never mounted yet is not dropped — it is still being
    // built — so only a root that left the document counts.
    if (this.root.isConnected) this.everConnected = true;
    else if (this.everConnected) {
      this.unsubscribeRetire?.();
      this.unsubscribeRetire = null;
      this.drag = null;
      return;
    }
    const drag = this.drag;
    if (drag) {
      if (event instanceof PointerEvent && event.pointerId !== drag.id) return;
      try {
        this.track.releasePointerCapture(drag.id);
      } catch {
        // Already released — the interrupt may have taken it.
      }
    }
    // Nothing paints the readout again until the user actually touches the
    // control: the browser's own focus restoration on return is not a request.
    this.interrupted = true;
    this.endSession(true);
    // Runs with no drag too: a focused thumb shows a readout without one.
    // Its no-index form also cancels a parked fade, whose throttled timer
    // would otherwise land long after the switch and paint the node again.
    this.hideBubble();
  };

  /** Whether the two thumbs sit close enough that a press cannot say which
   *  one it means. Half a thumb of slack covers both painted circles. */
  private isOverlapping(): boolean {
    if (!this.range) return false;
    const rect = this.track.getBoundingClientRect();
    if (rect.width <= 0) return false;
    const x0 = (rect.width * this.pct(this.values[0])) / 100;
    const x1 = (rect.width * this.pct(this.values[1])) / 100;
    return Math.abs(x1 - x0) <= 8;
  }

  /** Whether *clientX* falls strictly between the two thumbs — the rail
   *  segment a press treats as a pan target. A collapsed pair has no such
   *  segment; a press there still splits the stack as before. This is the
   *  single hit test for the pan: onTrackDown routes a press, and the hover
   *  cursor reads the same test, so a press can never pan where the cursor
   *  said grab. */
  private hitFill(clientX: number): boolean {
    if (!this.range || this.isOverlapping()) return false;
    // A segment spanning the whole extent leaves no rail to grab either
    // thumb: the fill would swallow the rail, so the pan feature yields and
    // the press keeps dragging the nearer thumb (full-extent sliders like the
    // filter panel's initial state must stay settable).
    if (this.values[0] <= this.opts.min && this.values[1] >= this.opts.max) {
      return false;
    }
    const rect = this.track.getBoundingClientRect();
    if (rect.width <= 0) return false;
    const xa = rect.left + (rect.width * this.visualPct(this.values[0])) / 100;
    const xb = rect.left + (rect.width * this.visualPct(this.values[1])) / 100;
    return clientX > Math.min(xa, xb) && clientX < Math.max(xa, xb);
  }

  /** Reflect whether *clientX* sits in the pan segment by toggling the track
   *  cursor class: grab while the pointer can pan, pointer (the class falls
   *  off) elsewhere. Class-based, never inline style. */
  private updateTrackCursor(clientX: number): void {
    const can = this.range && !this.disabled && !this.drag && this.hitFill(clientX);
    this.track.classList.toggle(SLIDER_CLASS.CAN_PAN, can);
  }

  /** Which thumb a press at *clientX* is meant for, and whether the answer
   *  is ambiguous because the two thumbs sit on top of each other. */
  private pickThumb(clientX: number): number {
    if (!this.range) return 0;
    if (this.isOverlapping()) {
      const rect = this.track.getBoundingClientRect();
      const centre = rect.left + (rect.width * this.visualPct(this.values[0])) / 100;
      // The lower thumb sits on the start side: left in LTR, right in RTL.
      const before = clientX < centre;
      return (this.rtl ? !before : before) ? 0 : 1;
    }
    return this.nearestThumb(clientX);
  }

  /** Only reachable for a range: pickThumb answers a single thumb itself. */
  private nearestThumb(clientX: number): number {
    const value = this.valueAt(clientX);
    return Math.abs(value - this.values[0]) <= Math.abs(value - this.values[1]) ? 0 : 1;
  }

  private valueAt(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    if (rect.width === 0) return this.values[0];
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fraction = this.rtl ? 1 - ratio : ratio;
    return this.opts.min + fraction * (this.opts.max - this.opts.min);
  }

  private setFromClientX(clientX: number, index: number): void {
    const next = this.round(this.valueAt(clientX));
    if (next === this.values[index]) {
      // The row already renders this value; a sync would only rewrite the
      // same ARIA, styles and bubble text on every repeated pointer frame.
      return;
    }
    this.applyValue(index, next);
    // Only reachable from the two drag paths, both of which set `this.drag`.
    this.drag!.dirty = true;
    this.sync();
    this.emit("input");
  }

  /** Translate the pair by the pointer's movement since the press, preserving
   *  the width and clamping so neither end leaves [min, max]. */
  private panByClientX(clientX: number): void {
    const drag = this.drag;
    if (!drag?.pan) return;
    const [startLo, startHi] = drag.startValues!;
    const width = startHi - startLo;
    // Pointer delta in value units (valueAt already mirrors RTL).
    const delta = this.valueAt(clientX) - this.valueAt(drag.startClientX!);
    const nextLo = clamp(
      this.round(startLo + delta),
      this.opts.min,
      this.opts.max - width,
    );
    const nextHi = nextLo + width;
    if (nextLo === this.values[0] && nextHi === this.values[1]) return;
    this.values[0] = nextLo;
    this.values[1] = nextHi;
    this.drag!.dirty = true;
    this.sync();
    this.emit("input");
    this.updateBubbles();
  }

  private readonly onKeyDown = (event: KeyboardEvent, index: number): void => {
    if (this.disabled) return;
    const { min, max } = this.opts;
    const step = this.opts.step ?? 1;
    const page = Math.max(step, (max - min) / 10);
    let delta: number;
    switch (event.key) {
      // Horizontal keys follow the visual direction (native range behaviour):
      // in RTL the left arrow raises the value. Vertical keys and Home/End
      // keep the value semantics: up adds, down subtracts, Home is the
      // minimum and End the maximum.
      case "ArrowLeft":
        delta = this.rtl ? step : -step;
        break;
      case "ArrowRight":
        delta = this.rtl ? -step : step;
        break;
      case "ArrowDown":
        delta = -step;
        break;
      case "ArrowUp":
        delta = step;
        break;
      case "PageDown":
        delta = -page;
        break;
      case "PageUp":
        delta = page;
        break;
      case "Home":
        delta = min - this.values[index];
        break;
      case "End":
        delta = max - this.values[index];
        break;
      default:
        return;
    }
    // Past the switch this key is really the control's, which makes it real
    // input: the readout may be shown again. Clearing the marker before the
    // switch would let any unrelated key (a keystroke in a neighbouring field)
    // re-arm the bubble the interrupt just cleared.
    this.interrupted = false;
    // The key is the control's: prevent the page default, but let it bubble.
    // foliplus' shared dispatcher already stands aside for `role="slider"`
    // (inputOwnership), so stopping propagation here would only hide the
    // event from hosts that do not use that dispatcher.
    event.preventDefault();
    const next = this.round(this.values[index] + delta);
    if (next === this.values[index]) {
      this.sync();
      return;
    }
    this.applyValue(index, next);
    this.sync();
    this.showBubble(index);
    this.emit("input");
    this.emit("change");
  };

  private emit(kind: "input" | "change"): void {
    const value = this.value;
    if (kind === "input") this.opts.input?.(value);
    else this.opts.change?.(value);
  }

  // ── Bubble ──────────────────────────────────────────────────
  private showBubble(index: number): void {
    const thumb = this.thumbs[index];
    if (!thumb) return;
    const entry = showAnchor(thumb, this.root);
    this.bubbleAnchors.add(thumb);
    entry.el.textContent =
      this.opts.format?.(this.values[index]) ?? String(this.values[index]);
    entry.el.classList.add("is-on");
    placeBubble(thumb.getBoundingClientRect(), entry.el);
  }

  /** Refresh every bubble this slider owns. Text is updated synchronously so
   *  the readout stays in step with the value on the same frame; placement is
   *  coalesced to one frame so several pointer moves in a frame (or two bubbles
   *  on a pan) do not each read a rect and write styles. */
  private updateBubbles(): void {
    if (this.bubbleAnchors.size === 0) return;
    for (const anchor of this.bubbleAnchors) {
      const entry = bubbles.get(anchor);
      if (entry) {
        const index = this.thumbs.indexOf(anchor);
        if (index >= 0) {
          entry.el.textContent =
            this.opts.format?.(this.values[index]) ?? String(this.values[index]);
        }
      }
    }
    if (this.bubbleFrame) return;
    this.bubbleFrame = requestAnimationFrame(() => {
      this.bubbleFrame = 0;
      for (const anchor of this.bubbleAnchors) {
        const entry = bubbles.get(anchor);
        if (entry) placeBubble(anchor.getBoundingClientRect(), entry.el);
      }
    });
  }

  private hideBubble(index?: number, immediate = false): void {
    const anchors =
      index === undefined
        ? [...this.bubbleAnchors, ...this.thumbs.filter(t => pendingHide.has(t))]
        : [this.thumbs[index]];
    if (this.bubbleFrame) {
      cancelAnimationFrame(this.bubbleFrame);
      this.bubbleFrame = 0;
    }
    for (const anchor of anchors) {
      if (!anchor) continue;
      // A fade may have already moved the anchor to the parked set; cancel
      // that timer and drop the node now (destroy must not leave it behind).
      const pending = pendingHide.get(anchor);
      if (pending) {
        clearTimeout(pending.timer);
        pendingHide.delete(anchor);
        pending.el.remove();
      }
      hideAnchor(anchor, immediate);
      this.bubbleAnchors.delete(anchor);
    }
  }
}

export { Slider, finishSlidersIn, sliderOf };
