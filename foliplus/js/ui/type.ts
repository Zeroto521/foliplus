// ui/type — the shared panel-engine type surface.
//
// The overlay engines (dropdown, listbox, placement, schemePicker, slider) each
// declare a public "result / contract" interface that consumers read through
// #ui/index.js. The types are pure (no runtime value), so they live here
// instead of being re-exported from each engine module: an engine that declares
// a type imports it from ./type.js, and the index barrel forwards the public
// names unchanged. Moving a type here is a pure type move — it never changes
// the runtime shape or the export names consumers see.

/** The dropdown engine's public handle (returned by createDropdown). */
interface Dropdown {
  element: HTMLElement;
  trigger: HTMLButtonElement;
  getList(): HTMLElement | null;
  isOpen(): boolean;
  getValue(): string;
  getValues(): readonly string[];
  setValue(value: string): void;
  setValues(values: readonly string[]): void;
  refresh(): void;
  setHint(text: string): void;
  open(): void;
  close(opts?: { restoreFocus?: boolean }): void;
  toggle(): void;
  destroy(): void;
}

/** The surface contract a dropdown/listbox consumer can implement to opt into
 *  host-surface (fullscreen / pseudo-fullscreen) resolution. */
interface DropdownSurface {
  resolveHost?: (() => HTMLElement | null) | null;
  onSurfaceChange?: ((cb: () => void) => () => void) | null;
}

/** An axis-aligned rectangle in surface coordinates. */
interface PlacementBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A 2D surface size. */
interface SurfaceSize {
  width: number;
  height: number;
}

interface PlacementOpts {
  /**
   * Minimum number of rows the caller wants visible. The surface height is
   * floored at minRows * rowHeight when the caller insists on keeping a
   * set of rows on screen.
   */
  minRows?: number;
  /** Height of a single row, paired with minRows. */
  rowHeight?: number;
  /** Gap between the anchor and the floating surface. Defaults to 0. */
  gap?: number;
  /**
   * Width strategy: "anchor" uses the anchor's width, a number uses that
   * fixed width, and the default (omitted) uses the surface's natural width.
   * The result is reported as maxWidth, which shrinks to the bounds when
   * the preferred width does not fit.
   */
  width?: "anchor" | number;
  /**
   * Optional natural (content) size, overriding surface for the width and
   * height caps. Use this when the caller measures a provisional size but
   * knows the content's true natural size.
   */
  natural?: SurfaceSize;
}

interface Placement {
  top: number;
  left: number;
  side: "below" | "above";
  maxWidth: number;
  maxHeight: number;
}

/** The scheme picker engine's public handle (returned by createSchemePicker). */
interface SchemePicker {
  /** Set the selected scheme without closing the dropdown or triggering
   *  onChange. Use to programmatically update the display. */
  setValue(name: string): void;
  /** Select a scheme: close the dropdown, update all DOM, and call onChange. */
  selectScheme(name: string): void;
  /** Update the number of classes and redraw all color bars. */
  setNumClasses(n: number): void;
  /** Redraw color bars in an open dropdown (e.g. after numClasses changes). */
  refresh(): void;
  /** Toggle the dropdown open/close. */
  toggle(): void;
  /** Close the dropdown. Set restoreFocus to false when the close was
   *  triggered by outside-click, data-clear, or destroy — those should
   *  not yank the user's focus back to the trigger. */
  close(opts?: { restoreFocus?: boolean }): void;
  /** Get the current dropdown element (null when closed). */
  getDropdown(): HTMLElement | null;
  /** Destroy all listeners, timers, and DOM elements. */
  destroy(): void;
}

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

export type {
  Dropdown,
  DropdownSurface,
  PlacementBox,
  SurfaceSize,
  PlacementOpts,
  Placement,
  SchemePicker,
  SliderValue,
  SliderMark,
  SliderCurrent,
  SliderOptions,
};
