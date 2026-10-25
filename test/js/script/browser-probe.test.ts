import { describe, expect, it } from "vitest";
import {
  buildReport,
  main,
  parseArgs,
  parseProbe,
  renderSummary,
  renderText,
} from "#script/browser-probe.mjs";

// The runner only reads the checkout. The real corpus is the interesting case
// here; fixture-root branches (parse errors, dangling refs, strict exit) are
// covered by the smoke test and the CI job that calls the CLI directly.
const ROOT = process.cwd();

describe("browser probe runner", () => {
  it("accepts the two forms Playwright evaluate accepts", () => {
    expect(parseProbe("() => 1;")).toBeNull();
    expect(parseProbe("sel => getComputedStyle(sel).borderRadius;")).toBeNull();
    expect(parseProbe("const el = document.body; el.dataset.x = 1;")).toBeNull();
    expect(parseProbe("const = ;")).toContain("Unexpected token");
  });

  it("parses the CLI flags", () => {
    expect(parseArgs(["--strict", "--github-summary", "--json", "out.json"])).toEqual({
      strict: true,
      githubSummary: true,
      jsonPath: "out.json",
    });
    expect(parseArgs([])).toEqual({
      strict: false,
      githubSummary: false,
      jsonPath: undefined,
    });
  });

  it("inventories the real corpus with no parse or reference problems", () => {
    const report = buildReport(ROOT);
    expect(report.totals.probes).toBeGreaterThan(400);
    expect(report.totals.parsed).toBe(report.totals.probes);
    expect(report.totals.parseErrors).toBe(0);
    expect(report.totals.orphanProbes).toBe(0);
    expect(report.totals.danglingReferences).toBe(0);
    const byDirTotal = Object.values(report.byDir).reduce(
      (sum, count) => sum + (count as number),
      0,
    );
    expect(byDirTotal).toBe(report.totals.probes);
  });

  it("renders text and the GitHub job summary from one report", () => {
    const report = buildReport(ROOT);
    expect(renderText(report).join("\n")).toContain("files under test/js/browser");
    expect(renderSummary(report).join("\n")).toContain(
      "## Browser probes (informational)",
    );
  });

  it("returns 0 for the real corpus in strict mode", () => {
    expect(main(["--strict"], {})).toBe(0);
  });
});
