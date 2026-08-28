import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelHTML } from "#foliplus/LayerControl/template.js";

describe("panelHTML", () => {
  beforeEach(() => {
    vi.stubGlobal("CONF", { name: "LayerControl" });
  });

  const T = (key: string): string => {
    const map: Record<string, string> = {
      toggle_title: "Toggle layers",
      panel_title: "Layers",
      close_title: "Close",
    };
    return map[key] ?? key;
  };

  it("returns a string containing the panel structure", () => {
    const html = panelHTML(T);
    expect(typeof html).toBe("string");
    expect(html).toContain("foliplus-layer-ctrl");
    expect(html).toContain("foliplus-toggle-btn");
    expect(html).toContain("foliplus-layer-panel");
    expect(html).toContain("foliplus-panel-header");
    expect(html).toContain("foliplus-close-btn");
    expect(html).toContain("foliplus-panel-content");
  });

  it("includes the control id from CONF.name", () => {
    const html = panelHTML(T);
    expect(html).toContain('id="LayerControl_ctrl"');
  });

  it("includes translated toggle title", () => {
    const html = panelHTML(T);
    expect(html).toContain("Toggle layers");
  });

  it("includes translated panel title", () => {
    const html = panelHTML(T);
    expect(html).toContain("Layers");
  });

  it("includes translated close title", () => {
    const html = panelHTML(T);
    expect(html).toContain("Close");
  });

  it("includes the LAYERS and CLOSE SVGs", () => {
    const html = panelHTML(T);
    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
  });
});
