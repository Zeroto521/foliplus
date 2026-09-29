/**
 * script/css-layers.mjs — build-time CSS Cascade Layer wrapping.
 *
 * Layer design (folio of T251):
 *   foliplus.tokens     token.css — design tokens on :root
 *   foliplus.base       remaining css/common/* (reset, chrome, shared utils)
 *   foliplus.components component stylesheets (flat file or split entry)
 *
 * Every emitted CSS artifact starts with the same order statement, so the
 * injection order of separate `<style>` tags cannot invert the cascade:
 *
 *   @layer foliplus.tokens, foliplus.base, foliplus.components;
 *
 * Intra-package cascade after this change:
 *   tokens < base < components — later layer wins at equal specificity.
 *   Within each layer, declaration order is the pre-change merge order
 *   (common: topological via orderCss; components: expandEntry order).
 *
 * Host-page semantics (CHANGELOG adjudicates):
 *   - Unlayered host CSS beats foliplus at any specificity (normal decls).
 *   - foliplus `!important` inside a layer still beats unlayered host
 *     `!important` (CSS layer inversion for important declarations).
 *   - Token theming: override `--foliplus-*` on a host rule (unlayered
 *     wins) or place overrides in a later layer than `foliplus.tokens`.
 *
 * Support floor: CSS Cascade Layers — Chrome/Edge 99+, Firefox 97+
 * (ESR 128 fully supported), Safari 15.4+. No polyfill. Browsers below the
 * floor ignore `@layer` blocks and would drop foliplus chrome entirely.
 */

/** Modules in css/common/ that belong in the tokens layer. */
const TOKEN_MODULES = new Set(["token.css"]);

/** Canonical layer order statement. Identical on every CSS artifact. */
const LAYER_ORDER = "@layer foliplus.tokens, foliplus.base, foliplus.components;";

/** Assemble the order preamble plus any non-empty layer blocks. */
const assemble = layers => {
  const parts = [LAYER_ORDER];
  for (const [name, bodies] of layers) {
    const body = bodies
      .filter(Boolean)
      .map(s => s.replace(/\s+$/, ""))
      .join("\n")
      .trim();
    if (!body) continue;
    parts.push(`@layer ${name} {\n${body}\n}`);
  }
  return `${parts.join("\n")}\n`;
};

/**
 * Wrap a dependency-ordered common merge.
 *
 * @param {string[]} orderedFilenames topological order from `orderCss`
 * @param {(file: string) => string} bodyOf imports-stripped module body
 * @returns {string} layered stylesheet
 */
const wrapCommonLayers = (orderedFilenames, bodyOf) => {
  const tokens = [];
  const base = [];
  for (const file of orderedFilenames) {
    const body = bodyOf(file);
    if (TOKEN_MODULES.has(file)) tokens.push(body);
    else base.push(body);
  }
  return assemble([
    ["foliplus.tokens", tokens],
    ["foliplus.base", base],
    ["foliplus.components", []],
  ]);
};

/**
 * Wrap component CSS (a flat stylesheet or an expanded split entry) into the
 * components layer. Token/base layers are emitted empty here so the order
 * preamble still lists them — injection order across artifacts cannot invert
 * the cascade.
 *
 * @param {string} body component stylesheet body (nesting may remain; postcss
 *   runs after this wrap at esbuild onLoad)
 * @returns {string} layered stylesheet
 */
const wrapComponentLayers = body =>
  assemble([
    ["foliplus.tokens", []],
    ["foliplus.base", []],
    ["foliplus.components", [body]],
  ]);

export { LAYER_ORDER, TOKEN_MODULES, assemble, wrapCommonLayers, wrapComponentLayers };
