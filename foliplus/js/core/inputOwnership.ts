// core/inputOwnership — input ownership: the single rule for "does the
// focused control natively consume this key, so foliplus must neither act
// nor preventDefault?"
//
// The same question used to be answered five different ways across the code
// base — a container-contains-focus check, two per-cursor `isFormInput`
// copies, a class-list enumeration, an `instanceof` narrowing, and a selector
// whitelist. Every one of them enumerated the controls to *skip*, so adding a
// single native control to a panel meant patching every copy and missing one
// was a bug.
//
// One table answers it here, keyed by control × key: the same element consumes
// different keys depending on its type (a checkbox owns Space only, a range
// owns arrows and page keys, a text field owns arrows/Home/End/Enter). Adding
// a new native control to a panel is now a table entry, not five guard edits.

type NativeClass = "edit" | "step" | "toggle" | "select" | "editable" | "none";

/** Keys foliplus owns no matter which control holds focus. Declared once so
 *  that no row of the native table can ever swallow them — Escape always
 *  reaches the panel that opened, regardless of the focused control. */
const OWNER_KEYS: ReadonlySet<string> = new Set(["Escape"]);

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;

/** The table. `"*"` means every key but the owner keys. */
const NATIVE_KEYS: Record<Exclude<NativeClass, "none">, ReadonlySet<string> | "*"> = {
  edit: new Set([...ARROWS, "Home", "End", "Enter"]),
  step: new Set([...ARROWS, "Home", "End", "PageUp", "PageDown"]),
  toggle: new Set([" "]),
  select: new Set([...ARROWS, "Enter", " "]),
  editable: "*",
};

const STEP_TYPES = new Set([
  "range",
  "color",
  "date",
  "time",
  "datetime-local",
  "week",
  "month",
]);
const TOGGLE_TYPES = new Set(["checkbox", "radio"]);

/** Elements a user drives with the pointer — controls plus the editable
 *  surface. Wider than the keyboard table below on purpose: `button` owns no
 *  key for foliplus (the panel opens menus and folds groups from it) but it
 *  still owns the click, which is what a dblclick gate has to let through. */
const POINTER_CONTROL_TAGS = new Set(["input", "select", "textarea", "button"]);

/** `input` types that are not keyboard-editable and own nothing here. */
const NONE_TYPES = new Set(["hidden", "button", "submit", "reset", "file", "image"]);

/** True when `el` is directly editable. Reads the attribute, not
 *  `isContentEditable`, which jsdom does not implement — the attribute is the
 *  reflected source both environments agree on. */
const isEditableEl = (el: Element): boolean => {
  const attr = el.getAttribute("contenteditable");
  return attr === "true" || attr === "";
};

/** Classify an element into the native-consumer family it belongs to.
 *  An unrecognized `input` type defers to native rather than claiming:
 *  browsers normalize it to text, and deferring a key is harmless where
 *  claiming one is the bug this module exists to stop. */
const nativeClass = (el: Element | null): NativeClass => {
  if (!el) return "none";
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "edit";
  if (tag === "select") return "select";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
    if (NONE_TYPES.has(type)) return "none";
    if (TOGGLE_TYPES.has(type)) return "toggle";
    if (STEP_TYPES.has(type)) return "step";
    return "edit";
  }
  if (isEditableEl(el)) return "editable";
  return "none";
};

/** The element that owns the key: the focused one, falling back to the event
 *  target. `document.activeElement` is non-null in practice (browsers and
 *  jsdom fall back to `body`), which is what makes the single lookup sound. */
const keyOwner = (event: { target?: unknown }): Element | null => {
  const active = document.activeElement;
  if (active instanceof Element) return active;
  return event.target instanceof Element ? event.target : null;
};

/** Does the element natively consume `key`, so foliplus must stand aside —
 *  neither act nor `preventDefault`? This is the one predicate every
 *  dispatch site asks before touching a key. */
const nativeConsumesKey = (el: Element | null, key: string): boolean => {
  if (OWNER_KEYS.has(key)) return false;
  const cls = nativeClass(el);
  if (cls === "none") return false;
  const keys = NATIVE_KEYS[cls];
  return keys === "*" ? true : keys.has(key);
};

/** Whether `el` is a control the user drives themselves — the pointer-side
 *  companion of {@link nativeConsumesKey}, for gates that ask "is this press
 *  on a control, or on the surface". */
const isNativeControl = (el: Element | null): boolean => {
  if (!el) return false;
  if (POINTER_CONTROL_TAGS.has(el.tagName.toLowerCase())) return true;
  return isEditableEl(el);
};

export { OWNER_KEYS, isNativeControl, keyOwner, nativeClass, nativeConsumesKey };
