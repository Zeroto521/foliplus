// ui/dropdownClassName — single source for the shared dropdown class names.
//
// The dropdown primitive's vocabulary was an inline object in dropdown.ts; the
// class-owner guard could not see it (dropdown.ts is not a *ClassName.ts owner
// file), so every token sat in the baseline as scanner-blind. Moving it here
// gives each token a declared owner the guard scans, and every consumer reads
// the one spelling.
//
// Pure data — no runtime import, no map, no DOM — so any layer may import it.
const DROPDOWN_CLASS = {
  WRAPPER: "foliplus-dropdown",
  TRIGGER: "foliplus-dropdown-trigger",
  LABEL: "foliplus-dropdown-label",
  PLACEHOLDER: "foliplus-dropdown-placeholder",
  LIST: "foliplus-dropdown-list",
  FOOTER: "foliplus-dropdown-footer",
  OPTION: "foliplus-dropdown-option",
  OPTION_LABEL: "foliplus-dropdown-option-label",
  OPEN: "foliplus-dropdown-open",
  UP: "foliplus-dropdown-up",
  PORTAL: "foliplus-dropdown-portal",
  SELECTED: "foliplus-is-selected",
  NATIVE_HOST: "foliplus-dropdown-native-host",
} as const;

export { DROPDOWN_CLASS };
