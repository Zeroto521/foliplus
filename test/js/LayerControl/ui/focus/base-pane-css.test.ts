import { afterEach, describe, expect, it } from "vitest";

// The focus-mode hide rule from foliplus/css/LayerControl/focus.css. This
// test runs it against jsdom's real selector engine — the Python-side
// companion test only checks the CSS source text carries both :not()
// exclusions, this one checks the rule *behaves* the way the CSS
// promises: base panes and the focused layer's pane are excluded,
// every other layer pane is matched.

const HIDE_RULE =
  ".foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane):not(.foliplus-base-pane)";

const makeContainer = (focusMode: boolean): HTMLElement => {
  const el = document.createElement("div");
  el.classList.add("leaflet-container");
  if (focusMode) el.classList.add("foliplus-is-focus-mode");
  return el;
};

const makePane = (extraClasses: string[]): HTMLElement => {
  const el = document.createElement("div");
  el.classList.add("foliplus-layer-pane");
  for (const cls of extraClasses) el.classList.add(cls);
  return el;
};

describe("focus-mode hide rule (CSS selector)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("matches an ordinary overlay pane when focus is active", () => {
    const container = makeContainer(true);
    const pane = makePane([]);
    container.appendChild(pane);
    document.body.appendChild(container);

    expect(document.querySelectorAll(HIDE_RULE)).toContain(pane);
  });

  it("does not match a base-group pane (the tile basemap / color basemap)", () => {
    const container = makeContainer(true);
    const basePane = makePane(["foliplus-base-pane"]);
    container.appendChild(basePane);
    document.body.appendChild(container);

    expect(document.querySelectorAll(HIDE_RULE)).not.toContain(basePane);
  });

  it("does not match the focused layer's own pane", () => {
    const container = makeContainer(true);
    const focusedPane = makePane(["foliplus-focus-pane"]);
    container.appendChild(focusedPane);
    document.body.appendChild(container);

    expect(document.querySelectorAll(HIDE_RULE)).not.toContain(focusedPane);
  });

  it("does not match a pane that carries both exclusions (a basemap that is also the focused layer — defensive)", () => {
    const container = makeContainer(true);
    const both = makePane(["foliplus-focus-pane", "foliplus-base-pane"]);
    container.appendChild(both);
    document.body.appendChild(container);

    expect(document.querySelectorAll(HIDE_RULE)).not.toContain(both);
  });

  it("does not match any pane when focus is not active (the outer class is the gate)", () => {
    const container = makeContainer(false);
    const base = makePane(["foliplus-base-pane"]);
    const focused = makePane(["foliplus-focus-pane"]);
    const other = makePane([]);
    container.appendChild(base);
    container.appendChild(focused);
    container.appendChild(other);
    document.body.appendChild(container);

    expect(document.querySelectorAll(HIDE_RULE).length).toBe(0);
  });

  it("matches only the unmarked panes when a mix of pane types is present under focus", () => {
    const container = makeContainer(true);
    const basePane = makePane(["foliplus-base-pane"]);
    const focusPane = makePane(["foliplus-focus-pane"]);
    const otherPane = makePane([]);
    container.appendChild(basePane);
    container.appendChild(focusPane);
    container.appendChild(otherPane);
    document.body.appendChild(container);

    const matched = Array.from(document.querySelectorAll(HIDE_RULE));
    expect(matched).toHaveLength(1);
    expect(matched[0]).toBe(otherPane);
  });
});
