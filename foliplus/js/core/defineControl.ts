// core/defineControl — shared component entry factory.
//
// Collapses the skeleton every component index.ts used to repeat:
// createControlEnv → createScopedTranslator → optional bootstrap →
// `class XControl extends BaseControl` with the lazy `manager` / `get m()`
// pair → `new XControl({ position: CONF.position }).addTo(map)`.
//
// The factory collects only the genuine common skeleton. Differences stay in
// the spec: controls that keep state on the instance (Search, Fullscreen,
// Scale, Locate) omit `createManager` and get no `manager` / `m` at all;
// controls with a heavy class body (Search, Heatmap) extend the factory's
// return value instead. Extra per-control methods go in the `methods` bag,
// Object.assigned onto the prototype so `this`-self-calls keep resolving.
//
// Lives in #core so it ships in the shared bundle and is externalized from
// every component; `conf` is therefore a spec field, not a free-variable read
// — the IIFE scope only exists in the component bundle that calls the factory.
//
// keepNames: the generated class name is `conf.name`, so `constructor.name`
// used by BaseControl's CONTROL_ATTACHED payload and the Python browser-test
// `window.__xxxCtrl` probes keep the declared identity.
//
// `destroy` convention: the hook releases the manager's resources and does NOT
// touch `this.manager` — the factory nulls it once, unconditionally, so
// `map.removeControl()` + `map.addControl()` always rebuilds a fresh manager.
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { type Logger, createLogger } from "#common/log.js";
import { createControlEnv } from "./controlEnv.js";

/** Environment handed to `setup` / `createManager` and carried on the
 *  generated control instance (`ctrl.conf` / `ctrl.T` / `ctrl._` / `ctrl.log`).
 *  `T` scopes keys by the component name; `_` is the bare lookup that
 *  identity-comparison sites (NAME_LABEL_KEY) need. */
type ControlEnv = {
  conf: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

/** The spec handed to {@link defineControl}. */
type DefineControlSpec<M = unknown> = {
  /** The component's CONF (the IIFE free variable). Drives env + class name. */
  conf: ComponentConfig;
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
  conf: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

/** Build the shared control shell and return it as a constructable class. */
function defineControl<M = unknown>(spec: DefineControlSpec<M>): ControlClass {
  const { conf, icon, setup, createManager, buildDOM, destroy, methods } = spec;

  createControlEnv(conf, icon);
  const T = createScopedTranslator(conf);
  const _ = createTranslator(conf);
  const log = createLogger(conf.name);
  const env: ControlEnv = { conf, T, _, log };
  setup?.(env);

  class Control extends BaseControl {
    readonly conf: ComponentConfig = conf;
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
    Object.defineProperty(Control.prototype, "m", {
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
      buildDOM: function (this: any) {
        return buildDOM.call(this);
      },
    });
  }
  if (destroy) {
    const hasManager = !!createManager;
    Object.assign(Control.prototype, {
      destroy: function (this: any) {
        destroy.call(this);
        if (hasManager) this.manager = null;
      },
    });
  }

  Object.defineProperty(Control, "name", { value: conf.name });

  return Control;
}

export { defineControl };
export type { ControlEnv, DefineControlSpec };
