// platform/domClassName — DOM class vocabulary shared with the popup layer.
//
// The popup-content token is written inside platform/dom.ts (a scanner-blind
// module), so it lives in a *ClassName.ts owner file that class-owner can see.
const DOM_CLASS = {
  /** The reverse-geocode popup's content wrapper. */
  POPUP_CONTENT: "foliplus-popup-content",
} as const;

export { DOM_CLASS };
