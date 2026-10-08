// core/defineControl — shared component entry factory.
//
// Collapses the skeleton every component index.ts used to repeat:
// createControlEnv → createScopedTranslator → optional bootstrap →
// `class XControl extends BaseControl` with the lazy `manager` / `get mgr()`
// pair → `new XControl({ position: CONFIG.position }).addTo(map)`.
//
// The factory collects only the genuine common skeleton. Differences stay in
// the spec: controls that keep state on the instance (Search, Fullscreen,
// Scale, Locate) omit `createManager` and get no `manager` / `mgr` at all;
// controls with a heavy class body (Search, Heatmap) extend the factory's
// return value instead. Extra per-control methods go in the `methods` bag,
// Object.assigned onto the prototype so `this`-self-calls keep resolving.
//
// Lives in #core so it ships in the shared bundle and is externalized from
// every component; `config` is therefore a spec field, not a free-variable read
// — the IIFE scope only exists in the component bundle that calls the factory.
//
// Free-variable boundary: the IIFE free variables (`CONFIG`, `map`) that the
// Python Jinja template injects are legitimate ENTRY-LAYER input — the
// component index.ts reads them to build the spec and the runtime bootstrap.
// Logic modules must not read them as module-level free variables; they
// receive them via `env` / explicit parameters / the control instance
// (`ctrl.map`-style access where a module needs the map). A public `map`
// accessor on the factory's class is the phase-2 direction for the ctrl path;
// until then the entry-layer `map` usage in index.ts and the logic layer's
// ctrl-mediated reads are the two sanctioned shapes.
//
// keepNames: the generated class name is `config.name`, so `constructor.name`
// used by BaseControl's CONTROL_ATTACHED payload and the Python browser-test
// `window.__xxxCtrl` probes keep the declared identity.
//
// `destroy` convention: the hook releases the manager's resources and does NOT
// touch `this.manager` — the factory nulls it once, unconditionally, so
// `map.removeControl()` + `map.addControl()` always rebuilds a fresh manager.
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import type { Logger } from "#common/type.js";
import { createControlEnv } from "./controlEnv.js";
import type { ControlEnv } from "./type.js";

/** The spec handed to {@link defineControl}. */
type DefineControlSpec<M = unknown> = {
  /** The component's CONFIG (the IIFE free variable). Drives env + class name. */
  config: ComponentConfig;
  /** Hint icon SVG. Omitted for ScaleControl (no toggle icon). */
  icon?: string;
  /** One-time bootstrap: ensureLayerAPI / requireLayerAPI / ensureHint / ... */
  setup?: (env: ControlEnv) => void;
  /** Lazy manager factory. Omit when the control keeps state on the instance. */
  createManager?: (env: ControlEnv) => M;
  /** Build the control DOM. Called by BaseControl.onAdd. */
  buildDOM?: (this: any) => HTMLElement;
  /** Component teardown; runs before the factory nulls `this.manager`. */
  destroy?: (this: any) => void;
  /** Extra prototype methods. Object.assigned onto the prototype. */
  methods?: { [key: string]: (this: any, ...args: any[]) => any };
};

/** The constructable class returned by {@link defineControl}. */
type ControlClass = new (options?: L.ControlOptions) => BaseControl & {
  config: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

/** Build the shared control shell and return it as a constructable class. */
const defineControl = <M = unknown>(spec: DefineControlSpec<M>): ControlClass => {
  const { config, icon, setup, createManager, buildDOM, destroy, methods } = spec;

  createControlEnv(config, icon);
  const T = createScopedTranslator(config);
  const _ = createTranslator(config);
  const log = createLogger(config.name);
  const env: ControlEnv = { config, T, _, log };
  setup?.(env);

  class Control extends BaseControl {
    readonly config: ComponentConfig = config;
    readonly T: (key: string) => string = T;
    readonly _: (key: string) => string = _;
    readonly log: Logger = log;
  }

  if (createManager) {
    Object.defineProperty(Control.prototype, "manager", {
      value: null,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(Control.prototype, "mgr", {
      configurable: true,
      enumerable: false,
      get(this: Control & { manager: M | null }) {
        return (this.manager ??= createManager(env));
      },
    });
  }

  if (methods) Object.assign(Control.prototype, methods);
  if (buildDOM) {
    Object.assign(Control.prototype, {
      buildDOM(this: any) {
        return buildDOM.call(this);
      },
    });
  }
  // The factory owns the manager-nulling contract documented above: whenever a
  // manager exists, the generated destroy nulls it unconditionally — after the
  // component's own destroy hook, if the spec supplies one. Keying the nulling
  // on `destroy` alone would trap a createManager-only spec into retaining a
  // stale manager across removeControl + addControl.
  if (destroy || createManager) {
    const hasManager = !!createManager;
    Object.assign(Control.prototype, {
      destroy(this: any) {
        destroy?.call(this);
        if (hasManager) this.manager = null;
      },
    });
  }

  Object.defineProperty(Control, "name", { value: config.name });

  return Control;
};

export { defineControl };
// eslint-disable-next-line import/no-unused-modules -- type-only export (rule bug: ignoreUnusedTypeExports doesn't work for `export { type X }`)
export type { ControlClass, DefineControlSpec };
