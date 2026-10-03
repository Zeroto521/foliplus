import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineControl } from "#core/defineControl.js";

// createControlEnv registers the hint icon via #core/hint.js — stub it so the
// factory under test stays focused on the shell it builds.
vi.mock("#core/hint.js", () => ({
  registerHintIcon: vi.fn(),
}));

const makeConfig = (overrides: Partial<ComponentConfig> = {}): ComponentConfig =>
  ({ name: "TestControl", locale_code: "en", ...overrides }) as ComponentConfig;

beforeEach(() => {
  vi.stubGlobal("foliplus", { showHint: vi.fn() });
});

describe("defineControl — bare shell", () => {
  it("returns a constructable class named after config.name", () => {
    const Ctrl = defineControl({ config: makeConfig() });
    const ctrl = new Ctrl();
    expect(ctrl.constructor.name).toBe("TestControl");
    expect(ctrl.config.name).toBe("TestControl");
    expect(typeof ctrl.T).toBe("function");
    expect(typeof ctrl._).toBe("function");
    expect(typeof ctrl.log.msg).toBe("function");
    expect(typeof ctrl.log.warn).toBe("function");
  });

  it("omits manager/m when createManager is not provided", () => {
    // Fullscreen / Scale / Locate / Search keep state on the instance.
    const Ctrl = defineControl({ config: makeConfig() });
    const ctrl = new Ctrl() as any;
    expect(ctrl.manager).toBeUndefined();
    expect(ctrl.m).toBeUndefined();
  });
});

describe("defineControl — optional spec arms", () => {
  it("calls setup once with the env", () => {
    const setup = vi.fn();
    defineControl({ config: makeConfig(), setup });
    expect(setup).toHaveBeenCalledTimes(1);
    const env = setup.mock.calls[0][0] as { config: ComponentConfig };
    expect(env.config.name).toBe("TestControl");
  });

  it("manager starts null and m lazily creates exactly once", () => {
    const createManager = vi.fn(() => ({ id: "mgr" }));
    const Ctrl = defineControl({ config: makeConfig(), createManager });
    const ctrl = new Ctrl() as any;
    expect(ctrl.manager).toBeNull();
    const m1 = ctrl.m;
    expect(createManager).toHaveBeenCalledTimes(1);
    expect(m1).toEqual({ id: "mgr" });
    // Re-read returns the cached instance, no second factory call.
    expect(ctrl.m).toBe(m1);
    expect(createManager).toHaveBeenCalledTimes(1);
  });

  it("methods bag lands on the prototype with this bound to the instance", () => {
    const methods = {
      greet(this: { config: ComponentConfig }) {
        return `hi ${this.config.name}`;
      },
    };
    const Ctrl = defineControl({ config: makeConfig(), methods });
    const ctrl = new Ctrl() as any;
    expect(ctrl.greet()).toBe("hi TestControl");
  });

  it("buildDOM proxies the spec fn with the instance as this", () => {
    const buildDOM = vi.fn(function (this: { config: ComponentConfig }) {
      return this.config.name;
    });
    const Ctrl = defineControl({ config: makeConfig(), buildDOM } as any);
    const ctrl = new Ctrl() as any;
    expect(ctrl.buildDOM()).toBe("TestControl");
    expect(buildDOM).toHaveBeenCalledTimes(1);
  });

  it("destroy runs the hook and nulls manager when createManager was given", () => {
    const destroy = vi.fn();
    const Ctrl = defineControl({
      config: makeConfig(),
      createManager: () => ({ id: "mgr" }),
      destroy,
    } as any);
    const ctrl = new Ctrl() as any;
    void ctrl.m; // materialize the manager
    ctrl.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ctrl.manager).toBeNull();
  });

  it("destroy runs the hook and leaves the instance untouched without createManager", () => {
    const destroy = vi.fn();
    const Ctrl = defineControl({ config: makeConfig(), destroy } as any);
    const ctrl = new Ctrl() as any;
    ctrl.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("nulls the manager on destroy even when the spec omits a destroy hook", () => {
    // The factory's manager contract: createManager-only specs must still get
    // a destroy that nulls manager, so re-add rebuilds a fresh manager.
    const createManager = vi.fn(() => ({ id: "mgr" }));
    const Ctrl = defineControl({ config: makeConfig(), createManager });
    const ctrl = new Ctrl() as any;
    const m1 = ctrl.m;
    expect(m1).toEqual({ id: "mgr" });
    ctrl.destroy();
    expect(ctrl.manager).toBeNull();
    // Re-access rebuilds — the factory's nulling is what makes re-add fresh.
    expect(ctrl.m).toEqual({ id: "mgr" });
    expect(createManager).toHaveBeenCalledTimes(2);
  });
});
