import { describe, expect, it, vi } from "vitest";
import { createPanelResetOutcome, finishPanelReset } from "#ui/index.js";

const focusTarget = (focus: () => void): HTMLElement =>
  ({ focus }) as unknown as HTMLElement;

describe("finishPanelReset", () => {
  it("keeps the panel open and focuses the trigger", () => {
    const close = vi.fn();
    const focus = vi.fn();
    finishPanelReset({ close, focus: focusTarget(focus) });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("leaves the close path untouched when no focus target exists", () => {
    const close = vi.fn();
    finishPanelReset({ close });

    expect(close).not.toHaveBeenCalled();
  });

  it("refreshes the open panel before focusing", () => {
    const order: string[] = [];
    finishPanelReset({
      close: vi.fn(),
      refresh: () => order.push("refresh"),
      focus: focusTarget(() => order.push("focus")),
    });

    expect(order).toEqual(["refresh", "focus"]);
  });

  it("resolves a focus target when the trigger is gone", () => {
    const close = vi.fn();
    const focus = vi.fn();
    finishPanelReset({
      close,
      focus: () => focusTarget(focus),
    });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("tolerates a resolver that finds no target", () => {
    const close = vi.fn();
    expect(() => finishPanelReset({ close, focus: () => null })).not.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("createPanelResetOutcome", () => {
  it("runs the surface close path when the policy dismisses", () => {
    const close = vi.fn();
    const focus = vi.fn();
    createPanelResetOutcome(true)({ close, focus: focusTarget(focus) });

    expect(close).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });

  it("keeps the panel open when the policy does not dismiss", () => {
    const close = vi.fn();
    const focus = vi.fn();
    createPanelResetOutcome(false)({ close, focus: focusTarget(focus) });

    expect(close).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });
});
