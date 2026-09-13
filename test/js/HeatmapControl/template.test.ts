import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelContentHTML } from "#foliplus/HeatmapControl/template.js";

describe("panelContentHTML", () => {
  beforeEach(() => {
    vi.stubGlobal("CONF", { name: "HeatmapControl" });
  });

  const T = (key: string) => {
    const map: Record<string, string> = {
      section_data: "Data",
      section_style: "Style",
      layer: "Layer",
      agg_method: "Aggregation",
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
      label: "Label",
      clear: "Clear",
      confirm: "OK",
    };
    return map[key] ?? key;
  };

  it("returns a string containing the heatmap panel structure", () => {
    const html = panelContentHTML(T);
    expect(typeof html).toBe("string");

    // Section containers
    expect(html).toContain("foliplus-heatmap-config-body");
    expect(html).toContain("foliplus-heatmap-extra-body");

    // Form rows — shared common/form.css primitives
    expect(html).toContain("foliplus-form-row");
    expect(html).toContain("foliplus-form-label");
    expect(html).toContain("foliplus-form-control");
    expect(html).toContain("foliplus-form-select");
    expect(html).toContain("foliplus-heatmap-form-row");
    expect(html).toContain("foliplus-heatmap-form-label");
    expect(html).toContain("foliplus-heatmap-form-control");
  });

  it("includes all data-hm-* query targets", () => {
    const html = panelContentHTML(T);
    const expectedAttrs = [
      "data-hm-layer",
      "data-hm-extra-body",
      "data-hm-agg",
      "data-hm-field",
      "data-hm-field-select",
      "data-hm-method",
      "data-hm-class-count",
      "data-hm-scheme-ctrl",
      "data-hm-scheme-hidden",
      "data-hm-border-color",
      "data-hm-label-chk",
      "data-hm-btn-clear",
      "data-hm-btn-confirm",
    ];
    for (const attr of expectedAttrs) {
      expect(html).toContain(attr);
    }
  });

  it("includes translated section headings", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("Data");
    expect(html).toContain("Style");
  });

  it("includes translated form labels", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("Layer");
    expect(html).toContain("Aggregation");
    expect(html).toContain("Field");
    expect(html).toContain("Classify");
    expect(html).toContain("Color");
    expect(html).toContain("Border");
    expect(html).toContain("Label");
  });

    // Live-updating controls mean there is no confirm/OK action to translate.
    expect(html).not.toContain("OK");
    const html = panelContentHTML(T);
    expect(html).toContain("Clear");
    expect(html).toContain("OK");
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

  it("includes classification method options", () => {
    const html = panelContentHTML(T);
    expect(html).toContain('value="jenks"');
    expect(html).toContain('value="quantile"');
    expect(html).toContain('value="equal"');
    expect(html).toContain('value="heads"');
    expect(html).toContain("Jenks");
    expect(html).toContain("Quantile");
    expect(html).toContain("Equal");
    expect(html).toContain("Heads");
  });

  it("includes class count options 2-9", () => {
    const html = panelContentHTML(T);
    for (let i = 2; i <= 9; i++) {
      expect(html).toContain(`<option value="${i}">${i}</option>`);
    }
  });

  it("includes border weight input constraints", () => {
    const html = panelContentHTML(T);
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="10"');
    expect(html).toContain('step="0.5"');
  });

  it("includes scheme bar with combobox role", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-scheme-bar");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="combobox"');
  it("includes label toggle switch structure (shared form primitives)", () => {
    expect(html).toContain("foliplus-toggle-switch");
    expect(html).toContain("foliplus-toggle-slider");
  it("includes label toggle switch structure", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-toggle-switch");
    expect(html).toContain("foliplus-heatmap-toggle-slider");
    expect(html).toContain('type="checkbox"');
  });

  it("includes border color picker", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-color-input");
    expect(html).toContain('type="color"');
  });

  it("includes border weight input", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-weight-input");
  });

  it("includes section divider", () => {
    const html = panelContentHTML(T);
  it("includes action button row (clear only — the panel is live-updating)", () => {
    expect(html).not.toContain("foliplus-heatmap-btn-confirm");
    expect(html).not.toContain("data-hm-btn-confirm");

  it("includes action button row", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-btn-row");
    expect(html).toContain("foliplus-heatmap-btn-clear");
    expect(html).toContain("foliplus-heatmap-btn-confirm");
  });

  it("extra body uses shared foliplus-hidden class by default", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("data-hm-extra-body>");
    expect(html).toMatch(/foliplus-heatmap-extra-body\s+foliplus-hidden/);
  });

  it("field selector uses shared foliplus-hidden class by default", () => {
    const html = panelContentHTML(T);
    expect(html).toContain("foliplus-heatmap-field");
    expect(html).toMatch(/foliplus-heatmap-field\s+foliplus-hidden/);
  });
});
