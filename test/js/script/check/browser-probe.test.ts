import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReport,
  errorMessage,
  main,
  parseArgs,
  parseProbe,
  renderSummary,
  renderText,
  runCli,
} from "#script/check/browser-probe.mjs";

// The runner only reads a checkout, so every branch runs against throwaway
// fixture roots: a literal-only corpus keeps double quotes (and their
// escaping) out of this file while still exercising the scanner.
const ROOT = process.cwd();

const write = (file: string, content: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

const roots: string[] = [];

type FixtureOptions = {
  allReferenced?: boolean;
  broken?: boolean;
  dangling?: boolean;
  many?: boolean;
  nested?: boolean;
  python?: boolean;
};

const makeFixture = (options: FixtureOptions = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "foliplus-browser-probe-"));
  roots.push(root);
  write(join(root, "test/js/browser/Alpha/one.js"), "() => 1;\n");
  write(join(root, "test/js/browser/Alpha/two.js"), "const x = 2;\n");
  if (options.nested) {
    write(join(root, "test/js/browser/root-level.js"), "() => 3;\n");
  }
  if (options.broken) {
    write(join(root, "test/js/browser/Alpha/broken.js"), "const = ;\n");
  }
  if (options.many) {
    for (let index = 0; index < 21; index += 1) {
      write(join(root, "test/js/browser/Many/more-" + index + ".js"), "() => 4;\n");
    }
  }
  if (options.python !== false) {
    write(join(root, "test/python/conftest.py"), "def _js(path):\n    return path\n");
    write(
      join(root, "test/python/test_refs.py"),
      [
        "from conftest import _js",
        "X = _js(" +
          String.fromCharCode(39) +
          "Alpha/one" +
          String.fromCharCode(39) +
          ")",
        ...(options.allReferenced
          ? [
              "W = _js(" +
                String.fromCharCode(39) +
                "Alpha/two" +
                String.fromCharCode(39) +
                ")",
            ]
          : []),
      ].join("\n") + "\n",
    );
    write(
      join(root, "test/python/notes.py"),
      [
        "``_js(" +
          String.fromCharCode(39) +
          "Doc/Example" +
          String.fromCharCode(39) +
          ")``",
        "# _js(" +
          String.fromCharCode(39) +
          "Comment/Nope" +
          String.fromCharCode(39) +
          ")",
        "name = " + String.fromCharCode(39) + "Alpha/one" + String.fromCharCode(39),
        "Y = _js(name)",
      ].join("\n") + "\n",
    );
    if (options.dangling) {
      write(
        join(root, "test/python/test_more.py"),
        "Z = _js(" +
          String.fromCharCode(39) +
          "Alpha/missing" +
          String.fromCharCode(39) +
          ")\n",
      );
    }
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("parseProbe — Playwright evaluate contract", () => {
  it("accepts the two forms Playwright accepts", () => {
    expect(parseProbe("() => 1;")).toBeNull();
    expect(parseProbe("sel => getComputedStyle(sel).borderRadius;")).toBeNull();
    expect(parseProbe("const el = document.body; el.dataset.x = 1;")).toBeNull();
  });

  it("returns the V8 message when neither form parses", () => {
    expect(parseProbe("const = ;")).toContain("Unexpected token");
  });
});

describe("parseArgs", () => {
  it("parses the CLI flags", () => {
    expect(parseArgs(["--strict", "--github-summary", "--json", "out.json"])).toEqual({
      strict: true,
      githubSummary: true,
      jsonPath: "out.json",
    });
  });

  it("treats a trailing --json as no path and defaults the rest off", () => {
    expect(parseArgs([])).toEqual({
      strict: false,
      githubSummary: false,
      jsonPath: undefined,
    });
    expect(parseArgs(["--json"]).jsonPath).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("unwraps Error and falls back to String for other values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("boom")).toBe("boom");
  });
});

describe("runCli", () => {
  it("sets the exit code only when the entry is this module", () => {
    const own: { exitCode?: number } = {};
    runCli(["--strict"], resolve("script/check/browser-probe.mjs"), own);
    expect(own.exitCode).toBe(0);

    const other: { exitCode?: number } = {};
    runCli(["--strict"], "/other/entry.mjs", other);
    expect(other.exitCode).toBeUndefined();

    const missing: { exitCode?: number } = {};
    runCli(["--strict"], undefined, missing);
    expect(missing.exitCode).toBeUndefined();
  });
});

describe("buildReport — inventory", () => {
  it("counts probes, orphans, dangling references and indirect calls", () => {
    const report = buildReport(makeFixture({ dangling: true, nested: true }));
    expect(report.totals.probes).toBe(3);
    expect(report.totals.parsed).toBe(3);
    expect(report.totals.parseErrors).toBe(0);
    expect(report.orphans.map((probe: { name: string }) => probe.name)).toEqual([
      "Alpha/two",
      "root-level",
    ]);
    expect(report.totals.orphanProbes).toBe(2);
    expect(report.dangling).toEqual([
      { reference: "Alpha/missing", files: ["test/python/test_more.py:1"] },
    ]);
    expect(report.indirect).toEqual(["test/python/notes.py:4"]);
    expect(report.byDir).toEqual({ Alpha: 2, "(root)": 1 });
  });

  it("flags a probe that no longer parses", () => {
    const report = buildReport(makeFixture({ broken: true }));
    expect(report.totals.parseErrors).toBe(1);
    expect(report.parseErrors).toEqual([
      { probe: "Alpha/broken", error: expect.stringContaining("Unexpected token") },
    ]);
    expect(report.totals.parsed).toBe(2);
  });

  it("handles a checkout with no Python tests", () => {
    const report = buildReport(makeFixture({ python: false }));
    expect(report.totals.references).toBe(0);
    expect(report.totals.orphanProbes).toBe(2);
    expect(report.indirect).toEqual([]);
  });

  it("skips _-prefixed support files and their references", () => {
    const root = makeFixture({ allReferenced: true });
    write(join(root, "test/js/browser/_parse_probe.js"), "() => 1;\n");
    write(
      join(root, "test/python/test_support.py"),
      ["from conftest import _js", "S = _js('_parse_probe')"].join("\n") + "\n",
    );

    const report = buildReport(root);
    expect(report.totals.probes).toBe(2);
    expect(report.totals.supportFiles).toBe(1);
    expect(report.totals.danglingReferences).toBe(0);
    expect(report.probes.map((probe: { name: string }) => probe.name)).not.toContain(
      "_parse_probe",
    );
  });

  it("inventories the real corpus", () => {
    const report = buildReport(ROOT);
    expect(report.totals.probes).toBeGreaterThan(400);
    expect(report.totals.parsed).toBe(report.totals.probes);
    expect(report.totals.parseErrors).toBe(0);
    expect(report.totals.orphanProbes).toBe(0);
    expect(report.totals.danglingReferences).toBe(0);
    expect(report.totals.supportFiles).toBeGreaterThanOrEqual(1);
    expect(
      Object.values(report.byDir).reduce(
        (sum: number, count) => sum + (count as number),
        0,
      ),
    ).toBe(report.totals.probes);
  });
});

describe("renderers", () => {
  it("renders the issue sections and truncates long lists", () => {
    const report = buildReport(
      makeFixture({ broken: true, dangling: true, many: true }),
    );
    const text = renderText(report).join("\n");
    expect(text).toContain("files under test/js/browser");
    expect(text).toContain("parse errors:");
    expect(text).toContain("orphan probes (no _js() reference):");
    expect(text).toContain("dangling references (no probe file):");
    expect(text).toContain("indirect _js() calls");
    expect(text).toMatch(/more$/m);
  });

  it("renders the GitHub job summary with details blocks", () => {
    const report = buildReport(
      makeFixture({ broken: true, dangling: true, many: true }),
    );
    const markdown = renderSummary(report).join("\n");
    expect(markdown).toContain("## Browser probes (informational)");
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("parse errors");
    expect(markdown).toContain("dangling references");
  });

  it("renders a clean summary without details sections", () => {
    const markdown = renderSummary(
      buildReport(makeFixture({ allReferenced: true })),
    ).join("\n");
    expect(markdown).not.toContain("<details>");
  });
});

describe("main — CLI contract", () => {
  it("writes the JSON artifact and the job summary", () => {
    const root = makeFixture({ dangling: true });
    const summary = join(root, "summary.md");
    const code = main(
      ["--json", "out.json", "--github-summary"],
      { GITHUB_STEP_SUMMARY: summary },
      root,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(readFileSync(join(root, "out.json"), "utf8"));
    expect(payload.totals.danglingReferences).toBe(1);
    expect(readFileSync(summary, "utf8")).toContain("## Browser probes");
  });

  it("skips the summary when the env hook is absent", () => {
    const root = makeFixture();
    expect(main([], {}, root)).toBe(0);
    expect(() => readFileSync(join(root, "summary.md"))).toThrow();
  });

  it("returns 1 under --strict only when the corpus has errors", () => {
    expect(main(["--strict"], {}, makeFixture())).toBe(0);

    const broken = makeFixture({ broken: true });
    expect(main(["--strict"], {}, broken)).toBe(1);
    expect(main([], {}, broken)).toBe(0);
  });

  it("runs as a script against this checkout", () => {
    const result = spawnSync(
      process.execPath,
      ["script/check/browser-probe.mjs", "--strict"],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("files under test/js/browser");
  }, 30_000);
});
