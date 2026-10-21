// Horizontal slider primitive — one thumb or two, foliplus chrome, no deps.
//
// The widget owns the interaction model that native <input type=range> cannot
// express: a single control with two thumbs that never cross. Everything
// geometric is CSS (common/slider.css); this module owns values, pointer and
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
import { dom } from "#common/dom.js";
import { SLIDER } from "./const.js";

/** One thumb (number) or a range (min/max pair). */
type SliderValue = number | [number, number];

/** A readout dot on the rail. Its ring reports coverage: accent where the
 *  selected span reaches it, gray where it does not. */
interface SliderMark {
  at: number;
  tone?: "limit" | "current";
}

/** The "where am I" readout under the rail (map zoom, playback position...).
 *  Not a value: it never moves a thumb. */
interface SliderCurrent {
  at: number;
  text: string;
  /** Hide the label when it would sit closer than this (percentage points)
   *  to either end, where the limit's own number already says it. */
  hideGapPct?: number;
}

interface SliderOptions {
  min: number;
  max: number;
  /** Value step. Defaults to 1. */
  step?: number;
  value: SliderValue;
  /** Accessible name for the control (single) or its group (range). */
  label: string;
  /** Accessible names for the two thumbs of a range. */
  labels?: [string, string];
  /** Rendered value, also the aria-valuetext. Defaults to a rounded number. */
  format?: (value: number) => string;
  /** Dots on the rail, in value units. */
  marks?: SliderMark[];
  /** The two fixed numbers under the rail's ends. */
  values?: { min: string; max: string };
  /** The moving readout under the rail, if this row has one. */
  current?: SliderCurrent | null;
  /** Live value while dragging / arrowing. */
  input?: (value: SliderValue) => void;
  /** Settled value: pointer release, or a keyboard step. */
  change?: (value: SliderValue) => void;
  /** Renders the control inert: no pointer, no keyboard, aria-disabled. */
  disabled?: boolean;
  /** Id of a description element, announced with the control (and, for a
   *  range, with the group). */
  describedBy?: string;
}

const INSTANCES = new WeakMap<HTMLElement, Slider>();

/** The slider rendered inside *host*, if any. */
const sliderOf = (host: Element | null): Slider | undefined =>
  host instanceof HTMLElement ? INSTANCES.get(host) : undefined;

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

// ── The value bubble ──────────────────────────────────────────────
// One element for the whole page: the row that owns it changes, the node does
// not. That keeps the bubble out of every panel's overflow and stacking
// context, which is what made it disappear under the header.
let bubbleEl: HTMLElement | null = null;
// Ownership is tracked by root element, not by instance reference: assigning
// `this` to a module variable reads as an alias and makes teardown order
// hard to reason about.
let bubbleOwner: HTMLElement | null = null;
let bubbleDismiss: (() => void) | null = null;
// One scroll listener for the whole page: the bubble is a singleton, so a
// per-instance listener would leak one handler per slider the panels ever
// built. Registered when the bubble is created.
let scrollBound = false;
let fullscreenBound = false;

/** Where the bubble lives: the fullscreen element when one is active (a
 *  native fullscreen renders only that subtree, so a node on <body> would be
 *  invisible), otherwise <body>. */
const bubbleHost = (): HTMLElement => {
  const fs = document.fullscreenElement as HTMLElement | null;
  // The root element is already the body's parent: appending there is the same
  // as appending to body, so only a sub-element (e.g. the map container) needs
  // the move.
  return fs && fs !== document.documentElement ? fs : document.body;
};

const bindFullscreen = (): void => {
  if (fullscreenBound) return;
  fullscreenBound = true;
  document.addEventListener("fullscreenchange", () => {
    // A tooltip does not survive the transition; the next focus re-shows it.
    bubbleDismiss?.();
    // Bound from ensureBubble, so the singleton exists by the time this runs.
    const el = bubbleEl!;
    const host = bubbleHost();
    if (el.parentElement !== host) host.appendChild(el);
  });
};

const ensureBubble = (): HTMLElement => {
  let el = bubbleEl;
  if (!el) {
    el = dom.el("div", {
      class: SLIDER.BUBBLE,
      "aria-hidden": "true",
    });
    el.hidden = true;
    bubbleEl = el;
  }
  bindFullscreen();
  const host = bubbleHost();
  if (el.parentElement !== host) host.appendChild(el);
  if (!scrollBound) {
    scrollBound = true;
    window.addEventListener("scroll", () => bubbleDismiss?.(), true);
  }
  return el;
};

/** Keep the bubble inside the viewport and pointing at *anchor*: above it
 *  when there is room, below otherwise, shifted horizontally so an edge thumb
 *  does not push it off-screen. */
const placeBubble = (anchor: DOMRect): void => {
  const bubble = ensureBubble();
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
  private active = -1;
  private drag: { id: number; index: number; dirty: boolean } | null = null;

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
    this.values = pair
      ? [Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])]
      : [initial as number];

    this.root = host;
    host.classList.add(SLIDER.ROOT);
    host.dataset.mode = this.range ? "range" : "single";
    if (this.range) {
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", this.opts.label);
    }

    this.track = dom.el("div", { class: SLIDER.TRACK });
    this.rail = dom.el("div", { class: SLIDER.RAIL });
    this.fill = dom.el("div", { class: SLIDER.FILL });
    this.rail.appendChild(this.fill);
    this.marksLayer = dom.el("div", { class: SLIDER.MARKS });
    this.valuesRow = dom.el("div", { class: SLIDER.VALUES });
    this.track.append(this.rail, this.marksLayer);

    this.values.forEach((_, index) => {
      const thumb = dom.el("div", {
        class: SLIDER.THUMB,
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

  /** Drop the bubble if this slider owns it (teardown path). */
  dismissBubble(): void {
    this.hideBubble();
  }

  /** Mirror the ARIA state onto the thumbs and the group. */
  private applyAria(): void {
    this.root.classList.toggle(SLIDER.DISABLED, this.disabled);
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
    this.endSession(false);
    if (bubbleOwner === this.root) this.hideBubble();
    INSTANCES.delete(this.root);
    this.root.replaceChildren();
    this.root.classList.remove("foliplus-slider");
    this.root.removeAttribute("role");
    this.root.removeAttribute("aria-label");
    this.root.removeAttribute("data-mode");
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
      dom.el("span", { class: SLIDER.VALUE_MIN }, this.opts.values.min),
      dom.el("span", { class: SLIDER.VALUE_MAX }, this.opts.values.max),
    );
    this.renderCurrent();
  }

  private renderCurrent(): void {
    this.currentEl?.remove();
    this.currentEl = null;
    const current = this.opts.current;
    if (!current || !this.opts.values) return;
    const label = dom.el("span", { class: SLIDER.VALUE_CURRENT }, current.text);
    this.currentEl = label;
    this.valuesRow.appendChild(label);
  }

  private renderMarks(): void {
    this.marksLayer.replaceChildren();
    this.dotEls = (this.opts.marks ?? []).map(mark => {
      const dot = dom.el("span", {
        class: SLIDER.DOT + (mark.tone === "current" ? ` ${SLIDER.DOT_CURRENT}` : ""),
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
      dot.classList.toggle(SLIDER.DOT_COVERED, at >= lo && at <= hi);
    }

    if (this.currentEl && this.opts.current) {
      const current = this.opts.current;
      this.currentEl.style.left = `${this.visualPct(current.at)}%`;
      const gap = current.hideGapPct ?? 0;
      const nearEnd =
        gap > 0 && (this.pct(current.at) < gap || this.pct(current.at) > 100 - gap);
      this.currentEl.classList.toggle(SLIDER.LABEL_HIDDEN, nearEnd);
    }

    if (this.active >= 0) this.updateBubble();
  }

  // ── Interaction ─────────────────────────────────────────────
  private bind(): void {
    this.track.addEventListener("pointerdown", this.onTrackDown);
    this.track.addEventListener("pointermove", this.onPointerMove);
    this.track.addEventListener("pointerup", this.onPointerUp);
    this.track.addEventListener("pointercancel", this.onPointerUp);
    this.track.addEventListener("lostpointercapture", this.onLostCapture);
    this.thumbs.forEach((thumb, index) => {
      thumb.addEventListener("pointerdown", event => this.onThumbDown(event, index));
      thumb.addEventListener("keydown", event => this.onKeyDown(event, index));
      thumb.addEventListener("focus", () => this.showBubble(index));
      thumb.addEventListener("blur", () => this.hideBubble());
    });
  }

  private readonly onTrackDown = (event: PointerEvent): void => {
    if (this.disabled) return;
    if (event.button !== undefined && event.button !== 0) return;
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

  private begin(event: PointerEvent, index: number, fromThumb: boolean): void {
    // One session at a time: a second finger must not overwrite the first
    // one's drag, or the first release would find nothing to commit.
    if (this.drag) return;
    event.preventDefault();
    this.active = index;
    this.drag = { id: event.pointerId, index, dirty: false };
    try {
      this.track.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimisation; the element listeners still fire.
    }
    this.thumbs[index].classList.add(SLIDER.DRAGGING);
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

  /** Close the live pointer session: release the drag flag and the thumb's
   *  visual state, and commit the last value when the drag actually moved. */
  private endSession(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.thumbs[drag.index]?.classList.remove(SLIDER.DRAGGING);
    this.hideBubble();
    if (commit && drag.dirty) this.emit("change");
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Explicit null check, not `!== this.drag?.id`: both sides are undefined
    // for a synthetic mouse event and a missing drag would pass that compare.
    const drag = this.drag;
    if (!drag) return;
    if (event.pointerId !== drag.id) return;
    this.setFromClientX(event.clientX, drag.index);
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
    this.active = index;
    const next = this.round(this.valueAt(clientX));
    if (next === this.values[index]) {
      this.sync();
      return;
    }
    this.applyValue(index, next);
    // Only reachable from the two drag paths, both of which set `this.drag`.
    this.drag!.dirty = true;
    this.sync();
    this.emit("input");
  }

  private readonly onKeyDown = (event: KeyboardEvent, index: number): void => {
    if (this.disabled) return;
    const { min, max } = this.opts;
    const step = this.opts.step ?? 1;
    const page = Math.max(step, (max - min) / 10);
    let delta: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        delta = -step;
        break;
      case "ArrowRight":
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
    // The key is the control's: prevent the page default, but let it bubble.
    // foliplus' shared dispatcher already stands aside for `role="slider"`
    // (inputOwnership), so stopping propagation here would only hide the
    // event from hosts that do not use that dispatcher.
    event.preventDefault();
    this.active = index;
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
    this.active = index;
    bubbleOwner = this.root;
    bubbleDismiss = this.hideBubble;
    const bubble = ensureBubble();
    bubble.hidden = false;
    bubble.textContent =
      this.opts.format?.(this.values[index]) ?? String(this.values[index]);
    bubble.classList.add("is-on");
    placeBubble(this.thumbs[index].getBoundingClientRect());
  }

  private updateBubble(): void {
    if (!bubbleEl || bubbleOwner !== this.root || this.active < 0) return;
    const value = this.values[this.active];
    const index = this.active;
    bubbleEl.textContent = this.opts.format?.(value) ?? String(value);
    // One placement per frame: a drag fires several pointer moves per frame on
    // a high-rate pointer, and each placement reads a rect and writes styles.
    if (this.bubbleFrame) return;
    this.bubbleFrame = requestAnimationFrame(() => {
      this.bubbleFrame = 0;
      if (!bubbleEl || bubbleOwner !== this.root || this.active < 0) return;
      placeBubble(this.thumbs[index].getBoundingClientRect());
    });
  }

  private readonly hideBubble = (): void => {
    if (this.bubbleFrame) {
      cancelAnimationFrame(this.bubbleFrame);
      this.bubbleFrame = 0;
    }
    this.active = -1;
    if (bubbleOwner !== this.root) return;
    bubbleOwner = null;
    bubbleDismiss = null;
    bubbleEl?.classList.remove("is-on");
    window.setTimeout(() => {
      if (!bubbleOwner && bubbleEl) bubbleEl.hidden = true;
    }, 150);
  };
}

export { Slider, sliderOf };
export type { SliderOptions };
