import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelContentHTML } from "#foliplus/HeatmapControl/template.js";

describe("panelContentHTML", () => {
  beforeEach(() => {
    vi.stubGlobal("CONFIG", { name: "HeatmapControl" });
  });

  const T = (key: string) => {
    const map: Record<string, string> = {
      layer: "Layer",
      agg_method: "Method",
      agg_count: "Count",
      agg_sum: "Sum",
      agg_avg: "Average",
      agg_min: "Min",
      agg_max: "Max",
      field: "Field",
      class_method: "Classify",
      jenks: "Jenks",
      quantile: "Quantile",
      equal: "Equal",
      heads: "Heads",
      scheme: "Color",
      clear: "Clear",
    };
    return map[key] ?? key;
  };

  it("returns a string containing the heatmap panel structure", () => {
    const html = panelContentHTML(T);
    expect(typeof html).toBe("string");

    // Section containers
    expect(html).toContain("foliplus-heatmap-config-body");
    expect(html).toContain("foliplus-heatmap-extra-body");

    // Section headings are gone: the panel is one flat row list, matching the
    // style and attributes panels.
    expect(html).not.toContain("foliplus-section-heading");

    // Form rows — shared common/form.css primitives
    expect(html).toContain("foliplus-form-row");
    expect(html).toContain("foliplus-form-label");
    expect(html).toContain("foliplus-form-control");
    expect(html).toContain("foliplus-form-select");
  });

  it("includes the template-owned data-heatmap-* query targets", () => {
    const html = panelContentHTML(T);
    const expectedAttrs = [
      "data-heatmap-layer",
      "data-heatmap-extra-body",
      "data-heatmap-agg",
      "data-heatmap-ramp-rows",
      "data-heatmap-btn-clear",
    ];
    for (const attr of expectedAttrs) {
      expect(html).toContain(attr);
    }
  });

  it("leaves the shared classification rows to the ramp-rows mount", () => {
    const html = panelContentHTML(T);
    // Field / Classes / Scheme are core/rampForm primitives mounted by ui.ts.
    // The template keeps their host only, so the markup cannot be duplicated.
    for (const attr of [
      "data-heatmap-field",
      "data-heatmap-field-select",
      "data-heatmap-method",
      "data-heatmap-class-count",
      "data-heatmap-scheme-ctrl",
      "data-heatmap-scheme-hidden",
    ]) {
      expect(html).not.toContain(attr);
    }
    expect(html).toContain("data-heatmap-ramp-rows");
  });

  it("includes translated form labels for its own rows", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("Layer");
    expect(html).toContain("Method");
    expect(html).toContain("Clear");
    // Field / Classify / Scheme labels now come from ui.ts + rampForm; the
    // template carries the mount only (the comment may name the rows).
    expect(html).not.toContain(">Field<");
    expect(html).not.toContain(">Classify<");
  });

  it("includes translated action button text", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("Clear");
    // Live-updating controls mean there is no confirm/OK action to translate.
    expect(html).not.toContain("OK");
  });

  it("includes aggregation method options", () => {
    const html = panelContentHTML(T);
    expect(html).toContain('value="count"');
    expect(html).toContain('value="sum"');
    expect(html).toContain('value="avg"');
    expect(html).toContain('value="min"');
    expect(html).toContain('value="max"');
    expect(html).toContain("Count");
    expect(html).toContain("Sum");
    expect(html).toContain("Average");
    expect(html).toContain("Min");
    expect(html).toContain("Max");
  });

  it("does not duplicate the classification controls markup", () => {
    const html = panelContentHTML(T);
    // Option lists (method order, 2-9 class counts) and the scheme trigger are
    // built once by core/rampForm and mounted by ui.ts.
    expect(html).not.toContain('value="jenks"');
    expect(html).not.toContain('value="2"');
    expect(html).not.toContain("foliplus-heatmap-scheme-bar");
    expect(html).not.toContain('role="combobox"');
  });

  it("includes section divider", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-section-divider");
  });

  it("includes action button row (clear only — the panel is live-updating)", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-btn-row");
    expect(html).toContain("foliplus-heatmap-btn-clear");
    expect(html).not.toContain("foliplus-heatmap-btn-confirm");
    expect(html).not.toContain("data-heatmap-btn-confirm");
  });

  it("extra body uses shared foliplus-hidden class by default", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("data-heatmap-extra-body>");
    expect(html).toMatch(/foliplus-heatmap-extra-body\s+foliplus-hidden/);
  });

  it("mounts the shared rows inside the style-rows block", () => {
    const html = panelContentHTML(T);
    expect(html).toMatch(/foliplus-heatmap-section-block"\s+data-heatmap-ramp-rows/);
  });
});
