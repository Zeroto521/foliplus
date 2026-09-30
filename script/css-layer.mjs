/**
 * script/css-layer.mjs — build-time CSS Cascade Layer wrapping.
 *
 * Layer design:
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
 * Leaflet-library overrides and dropdown/menu shells stay unlayered (see
 * {@link hoistCompatOverrides}):
 *   Leaflet ships unlayered CSS; any foliplus rule that targets `.leaflet-*`
 *   must keep beating it at the same specificity+order as before this change.
 *   Host-page authors still see layered foliplus chrome win/lose by layer
 *   order for non-Leaflet selectors.
 *
 * Host-page semantics (CHANGELOG adjudicates):
 *   - Unlayered host CSS beats foliplus layered rules at any specificity
 *     (normal decls) for non-Leaflet selectors.
 *   - foliplus `!important` inside a layer still beats unlayered host
 *     `!important` (CSS layer inversion for important declarations).
 *   - Token theming: override `--foliplus-*` on a host rule (unlayered
 *     wins) or place overrides in a later layer than `foliplus.tokens`.
 *
 * Support floor: CSS Cascade Layers — Chrome/Edge 99+, Firefox 97+
 * (ESR 128 fully supported), Safari 15.4+. No polyfill. Browsers below the
 * floor ignore `@layer` blocks and would drop foliplus chrome entirely.
 */
import postcss from "postcss";

/** Modules in css/common/ that belong in the tokens layer. */
const TOKEN_MODULES = new Set(["token.css"]);

/** Canonical layer order statement. Identical on every CSS artifact. */
const LAYER_ORDER = "@layer foliplus.tokens, foliplus.base, foliplus.components;";

/** Assemble the order preamble plus every non-empty layer block. Empty
 *  layers are skipped — their order is already fixed by the preamble. */
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
 * Wrap a dependency-ordered common merge: `token.css` into the tokens layer,
 * every other module into base.
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
  ]);
};

/**
 * Wrap component CSS (a flat stylesheet or an expanded split entry) into the
 * components layer. Token/base layers stay empty here — the preamble still
 * fixes their order, so injection order across artifacts cannot invert the
 * cascade.
 *
 * @param {string} body component stylesheet body (nesting may remain; postcss
 *   runs after this wrap at esbuild onLoad)
 * @returns {string} layered stylesheet
 */
const wrapComponentLayers = body => assemble([["foliplus.components", [body]]]);

/**
 * Unlayered-compat selector patterns.
 *
 * foliplus rules that must outrank a HOST framework's unlayered resets stay
 * out of `@layer`: the cascade spec gives unlayered normal declarations
 * priority over layered ones at ANY specificity, so a layered foliplus rule
 * loses to e.g. Bootstrap's `ol,ul{padding-left:2rem}` even at (0,2,0) vs
 * (0,0,1). Two families need this:
 *   - Leaflet chrome overrides (`.leaflet-*` selectors) — pre-existing;
 *   - dropdown / menu / row-panel shells whose `padding` / `margin` /
 *     `list-style` answers a framework's bare-element resets (Bootstrap,
 *     Tailwind, …). T264: the layer more-menu gained a 2rem left padding
 *     under Bootstrap before this hoist existed.
 * The list is explicit — no magic "any element selector" hoisting.
 */
const UNLAYERED_PATTERNS = [
  /\.leaflet/,
  /\.foliplus-layer-more-menu/,
  /\.foliplus-search-result-panel/,
  /\.foliplus-heatmap-scheme-dropdown/,
  /\.foliplus-row-panel/,
];

/**
 * Pull rules matching an {@link UNLAYERED_PATTERNS} selector out of `@layer`
 * blocks and re-append them unlayered.
 *
 * Before this change, foliplus rules that style/override Leaflet chrome or a
 * dropdown shell (`.foliplus-layer-more-menu`, `.foliplus-row-panel`, …) won
 * by specificity + source order. After wrapping every rule in a layer, those
 * overrides lose to the host's unlayered CSS at any specificity — browser
 * tests that pin hatch paint and scale/attribution height equality caught the
 * Leaflet half; T264's menu-shell padding caught the shell half.
 *
 * Hoisting restores the pre-layer cascade for these families while leaving
 * the rest of foliplus chrome in layers for host-page control.
 *
 * @param {string} css flattened stylesheet (may contain @layer blocks)
 * @returns {string} stylesheet with matching rules unlayered
 */
const hoistCompatOverrides = css => {
  const root = postcss.parse(css);
  const hoisted = [];
  root.walkRules(rule => {
    // postcss exposes `selectors` as an array on every Rule node (also for
    // @media / @keyframes child rules), so no fallback is needed here.
    const selectors = rule.selectors;
    if (selectors.some(s => UNLAYERED_PATTERNS.some(re => re.test(s)))) {
      hoisted.push(rule.clone());
      rule.remove();
    }
  });
  if (hoisted.length === 0) return css;
  // Append after the layer blocks: unlayered normal decls beat layered ones.
  for (const node of hoisted) root.append(node);
  return root.toString();
};

export {
  LAYER_ORDER,
  TOKEN_MODULES,
  UNLAYERED_PATTERNS,
  hoistCompatOverrides,
  wrapCommonLayers,
  wrapComponentLayers,
};
