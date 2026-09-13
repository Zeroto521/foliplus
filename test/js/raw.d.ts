// `?raw` imports resolve to the file's text at build time (vite), so tsc never
// opens the imported file — it only needs the declaration. Vite ships it as
// `*?raw`, but that wildcard does not match a specifier `paths` has already
// mapped to a real module (#core/…), so re-export it under the aliased forms.
// Vite is vitest's own dependency, not an added one.
//
// Global script (no import/export): ambient declarations are global by default,
// and `export {}` here would convert them into module-scoped ones that no other
// file can see.

declare module "#core/*?raw" {
  const src: string;
  export default src;
}

declare module "#script/*?raw" {
  const src: string;
  export default src;
}
