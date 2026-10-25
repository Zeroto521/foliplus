// core/inputOwnership — input ownership: the single rule for "does the
// focused control natively consume this key, so foliplus must neither act
// nor preventDefault?"
//
// The same question used to be answered five different ways across the code
// base — a container-contains-focus check, two per-cursor form-input checks,
// a class-list enumeration, an `instanceof` narrowing, and a selector
// whitelist. Every one of them enumerated the controls to *skip*, so adding a
// single native control to a panel meant patching every copy and missing one
// was a bug.
//
// One table answers it here, keyed by control × key: the same element consumes
// different keys depending on its type (a checkbox owns Space only, a range
// owns arrows and page keys, a text field owns arrows/Home/End/Enter). Adding
// a new native control to a panel is now a table entry, not five guard edits.

type NativeClass =
  "edit" | "step" | "toggle" | "select" | "editable" | "activate" | "link" | "none";

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
  // A control the browser activates from Enter/Space — a <button>, a
  // <summary>, or a submit/file `input`. The browser turns the key into a
  // click, so claiming it would leave the control inert: the panel close ×
  // is a real <button> sitting inside the layer row, and cancelling Space to
  // toggle the row behind it was exactly that bug.
  activate: new Set(["Enter", " "]),
  // A link activates on Enter only. Space on a focused link scrolls the page
  // and is not an activation key, so foliplus keeps it.
  link: new Set(["Enter"]),
};

/** Role-based controls, the ARIA equivalents of the native rows: a
 *  `role="slider"` thumb owns the step keys, `role="button"`/`"link"` own their
 *  activation keys, and the tri-state widget roles own Space (their toggle).
 *  A real tag wins over its role: a <button role="link"> still activates on
 *  Space natively, so the tag is classified before this table is consulted. */
const ROLE_CLASSES: Readonly<Record<string, NativeClass>> = {
  slider: "step",
  button: "activate",
  link: "link",
  checkbox: "toggle",
  switch: "toggle",
  radio: "toggle",
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

/** `input` types the browser activates from Enter/Space instead of typing
 *  into: buttons and the file picker. They are inert for text input but must
 *  not fall into the owning-nothing set — that was the same class of bug as
 *  the unclassified <button>. */
const ACTIVATE_TYPES = new Set(["button", "submit", "reset", "image", "file"]);

/** Elements a user drives with the pointer — controls plus the editable
 *  surface. Wider than the keyboard table above on purpose: this is the
 *  pointer-side gate (a dblclick on a control belongs to the control, not the
 *  row), while the key table decides which *keys* the same element consumes.
 *  A `button` is here for its click, and owns Enter/Space in the key table. */
const POINTER_CONTROL_TAGS = new Set(["input", "select", "textarea", "button"]);

/** `input` types that are not rendered and therefore own nothing at all. */
const NONE_TYPES = new Set(["hidden"]);

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
    if (ACTIVATE_TYPES.has(type)) return "activate";
    return "edit";
  }
  // Native activation elements: a focused <button>, <summary> or link turns
  // Enter/Space into a click. Tag first, role second: a real button keeps its
  // native Space activation even if it carries a different role.
  if (tag === "button" || tag === "summary") return "activate";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  const role = el.getAttribute("role");
  if (role && ROLE_CLASSES[role]) return ROLE_CLASSES[role];
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
  if (el.getAttribute("role") === "slider") return true;
  return isEditableEl(el);
};

export { OWNER_KEYS, isNativeControl, keyOwner, nativeClass, nativeConsumesKey };
