import { describe, expect, it, vi } from "vitest";
import { createPanelResetOutcome, finishPanelReset, runResetSteps } from "#ui/index.js";

const focusTarget = (focus: () => void): HTMLElement =>
  ({ focus }) as unknown as HTMLElement;

describe("runResetSteps", () => {
  it("keeps running after a step throws, reporting each failure", () => {
    const order: string[] = [];
    const onError = vi.fn();

    const failures = runResetSteps(
      [
        () => order.push("fill"),
        () => {
          throw new Error("boom");
        },
        () => order.push("label"),
      ],
      onError,
    );

    expect(order).toEqual(["fill", "label"]);
    expect(failures).toHaveLength(1);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("returns an empty failure list when every step lands", () => {
    expect(runResetSteps([() => {}, () => {}])).toEqual([]);
  });

  it("logs by default when no hook is supplied", () => {
    // A caller that forgot onError must not swallow the failure: the shared
    // logger is the default channel.
    expect(() =>
      runResetSteps([
        () => {
          throw new Error("boom");
        },
      ]),
    ).not.toThrow();
  });
});

describe("finishPanelReset", () => {
  it("refreshes and focuses even when a restore step throws", () => {
    const order: string[] = [];
    const onError = vi.fn();

    finishPanelReset({
      restore: [
        () => order.push("fill"),
        () => {
          throw new Error("boom");
        },
        () => order.push("label"),
      ],
      close: vi.fn(),
      refresh: () => order.push("refresh"),
      focus: focusTarget(() => order.push("focus")),
      onError,
    });

    // The failing dimension is skipped, but the reset still finishes: the
    // remaining dimensions, the refresh and the focus all ran.
    expect(order).toEqual(["fill", "label", "refresh", "focus"]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("keeps the panel open and focuses the trigger", () => {
    const close = vi.fn();
    const focus = vi.fn();
    finishPanelReset({ restore: () => {}, close, focus: focusTarget(focus) });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("leaves the close path untouched when no focus target exists", () => {
    const close = vi.fn();
    finishPanelReset({ restore: () => {}, close });

    expect(close).not.toHaveBeenCalled();
  });

  it("refreshes the open panel before focusing", () => {
    const order: string[] = [];
    finishPanelReset({
      restore: () => order.push("restore"),
      close: vi.fn(),
      refresh: () => order.push("refresh"),
      focus: focusTarget(() => order.push("focus")),
    });

    expect(order).toEqual(["restore", "refresh", "focus"]);
  });

  it("resolves a focus target when the trigger is gone", () => {
    const close = vi.fn();
    const focus = vi.fn();
    finishPanelReset({
      restore: () => {},
      close,
      focus: () => focusTarget(focus),
    });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("tolerates a resolver that finds no target", () => {
    const close = vi.fn();
    expect(() =>
      finishPanelReset({ restore: () => {}, close, focus: () => null }),
    ).not.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("createPanelResetOutcome", () => {
  it("runs the surface close path when the policy dismisses", () => {
    const order: string[] = [];
    createPanelResetOutcome(true)({
      restore: () => order.push("restore"),
      close: () => order.push("close"),
      focus: focusTarget(() => order.push("focus")),
    });

    expect(order).toEqual(["restore", "close"]);
  });

  it("keeps the panel open when the policy does not dismiss", () => {
    const close = vi.fn();
    const focus = vi.fn();
    createPanelResetOutcome(false)({
      restore: () => {},
      close,
      focus: focusTarget(focus),
    });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });
});
