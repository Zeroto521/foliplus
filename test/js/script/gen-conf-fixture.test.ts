import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrettierOptions,
  buildConfFixture,
  formatValue,
  main,
  resolveSchemaJson,
} from "#script/gen-conf-fixture.mjs";

// Shape matches foliplus/_schema.py's dump. Two controls share the `filename`
// key with different defaults — the regression the per-control grouping fixes.
// `buildControlDefaults` only reads `field.default`, so the branch-covering
// table below uses a compact spec.
const field = (ts: string, value: unknown) => ({ ts, default: value });
const schema = {
  version: 1,
  shared: {
    name: {
      ts: "string",
      optional: false,
      nullable: false,
      runtime_only: false,
      dynamic: false,
    },
  },
  runtime_only: {},
  controls: {
    ExportControl: {
      filename: {
        ts: "string",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: "map",
      },
    },
    MeasureControl: {
      filename: {
        ts: "string",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: "measurements",
      },
    },
    SearchControl: {
      mode: {
        ts: "union",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        values: ["coord", "addr"],
        default: "coord",
      },
      provider_config: {
        ts: "object",
        optional: true,
        nullable: true,
        runtime_only: false,
        dynamic: false,
        default: null,
      },
    },
    // Exercises formatValue's remaining value shapes: number, boolean, empty
    // array, non-empty array, and a nested object. Names are synthetic — the
    // real schema dump never declares an empty array or object default.
    DemoControl: {
      n_classes: field("number", 6),
      label_show: field("bool", true),
      groups: field("array_string", []),
      schemes: field("array_string", ["Blues", "Reds"]),
      label_format: field("object", { digits: 2 }),
      // No `default` key: buildControlDefaults must drop it rather than emit an
      // `undefined` literal into the fixture.
      tooltip_style: {
        ts: "string",
        optional: true,
        nullable: false,
      },
    },
  },
};

// buildConfFixture hands its output to prettier with the repo config, so a
// single call can take several seconds. Under the full suite's parallel load
// the first one in a file exceeded the default 5 s budget and failed at the
// `it(` line, which said nothing about the fixture — the same situation
// bundle-size-check.test.ts handles with SLOW. Assertions are unchanged.
const SLOW = 30000;

describe("PrettierOptions", () => {
  it("resolves the repo config so format() agrees with format:check", () => {
    // Same failure mode as the schema generator: a directory argument made
    // resolveConfig() search the parent directory and left format() on bare
    // prettier defaults in CI.
    const config = PrettierOptions as unknown as Record<string, unknown>;
    expect(Object.keys(config).length).toBeGreaterThan(0);
    expect(Array.isArray(config.plugins)).toBe(true);
    expect((config.plugins as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(config.importOrder)).toBe(true);
  });
});

describe("buildConfFixture", () => {
  it(
    "groups defaults per control — no cross-control collision",
    async () => {
      const text = await buildConfFixture(schema);
      // Both filename defaults survive; the earlier one no longer overwrites.
      expect(text).toMatch(/ExportControl: \{\n    filename: "map"/);
      expect(text).toMatch(/MeasureControl: \{\n    filename: "measurements"/);
    },
    SLOW,
  );

  it(
    "serializes explicit null defaults as null",
    async () => {
      const text = await buildConfFixture(schema);
      expect(text).toMatch(/provider_config: null,/);
    },
    SLOW,
  );

  it(
    "makeConf takes controlName and merges overrides last",
    async () => {
      const text = await buildConfFixture(schema);
      expect(text).toContain("function makeConf(");
      expect(text).toContain("controlName: string,");
      expect(text).toContain("overrides?: Partial<ComponentConfig>,");
      expect(text).toMatch(/name: controlName,/);
      expect(text).toContain("...CONF_DEFAULTS[controlName],");
      expect(text).toContain("...overrides,");
    },
    SLOW,
  );

  it(
    "exports makeConf via a bottom aggregate block",
    async () => {
      const text = await buildConfFixture(schema);
      const tail = text.slice(text.indexOf("export {"));
      expect(tail).toContain("export { makeConf };");
      // No inline export on the function declaration itself.
      expect(text).not.toContain("export function makeConf");
    },
    SLOW,
  );

  it(
    "is deterministic across calls",
    async () => {
      const a = await buildConfFixture(schema);
      const b = await buildConfFixture(schema);
      expect(a).toBe(b);
    },
    SLOW,
  );

  it(
    "renders every JSON value shape formatValue can receive",
    async () => {
      const text = await buildConfFixture(schema);
      expect(text).toMatch(/n_classes: 6,/);
      expect(text).toMatch(/label_show: true,/);
      expect(text).toMatch(/groups: \[\],/);
      expect(text).toMatch(/schemes: \["Blues", "Reds"\],/);
      expect(text).toMatch(/label_format: \{ digits: 2 \},/);
    },
    SLOW,
  );

  it(
    "omits fields that declare no default",
    async () => {
      const text = await buildConfFixture(schema);
      expect(text).not.toContain("tooltip_style");
    },
    SLOW,
  );
});

describe("formatValue", () => {
  it("throws on a value that cannot come from the schema JSON", () => {
    // buildControlDefaults only ever hands it JSON values, so anything else is
    // a caller bug. Failing loudly beats emitting a silent `undefined` or `{}`
    // literal into the generated fixture.
    expect(() => formatValue(Symbol("x"))).toThrow("unsupported value of type symbol");
    expect(() => formatValue(() => 1)).toThrow("unsupported value of type function");
  });
});

describe("main", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "reads --json and writes the generated fixture to --out",
    async () => {
      dir = mkdtempSync(join(tmpdir(), "gen-conf-fixture-"));
      const jsonPath = join(dir, "conf-schema.json");
      const outPath = join(dir, "conf-fixture.ts");
      writeFileSync(jsonPath, JSON.stringify(schema), "utf-8");

      await main({ json: jsonPath, out: outPath });

      const text = readFileSync(outPath, "utf-8");
      expect(text).toContain("AUTO-GENERATED by script/gen-conf-fixture.mjs");
      expect(text).toContain("export { makeConf };");
      expect(text).toMatch(/filename: "map"/);
      expect(text).toMatch(/filename: "measurements"/);
    },
    SLOW,
  );
});

describe("resolveSchemaJson", () => {
  it("resolves --json over the build's scratch copy", () => {
    expect(resolveSchemaJson({ json: "x.json" })).toBe(resolve("x.json"));
  });

  it("falls back to the build's scratch copy when --json is omitted", () => {
    // The globalSetup's generator run creates this file, so it exists by the
    // time tests execute; this pins the contract on its path.
    expect(resolveSchemaJson({})).toBe(
      resolve(process.cwd(), "foliplus", ".build", "js", "conf-schema.json"),
    );
  });
});

describe("CLI entry", () => {
  // `parseArgs(process.argv.slice(2))` and the self-detection guard both run at
  // import time, so they are only reachable by re-importing the module with
  // argv replaced. vi.resetModules() re-runs the module body; trapping
  // process.exit turns the exit into a rejection instead of killing the worker.
  const SCRIPT = resolve(process.cwd(), "script", "gen-conf-fixture.mjs");

  const trapExit = () =>
    vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`exit:${code}`);
      });

  const runCli = async (argv: string[]) => {
    const original = process.argv;
    try {
      Object.defineProperty(process, "argv", {
        value: argv,
        writable: true,
        configurable: true,
      });
      vi.resetModules();
      return await import("#script/gen-conf-fixture.mjs");
    } finally {
      Object.defineProperty(process, "argv", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--help prints the usage and exits 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = trapExit();
    await expect(runCli(["node", SCRIPT, "--help"])).rejects.toThrow("exit:0");
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.join("\n")).toContain("Usage:");
  });

  it("prints the error and exits 1 on an unknown flag", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = trapExit();
    await expect(runCli(["node", SCRIPT, "--bogus"])).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join("\n")).toContain("Unknown flag: --bogus");
  });

  it(
    "runs main() only when launched directly as a script",
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "gen-conf-fixture-cli-"));
      const jsonPath = join(tmp, "conf-schema.json");
      const outPath = join(tmp, "conf-fixture.ts");
      writeFileSync(jsonPath, JSON.stringify(schema), "utf-8");
      try {
        await runCli(["node", SCRIPT, "--json", jsonPath, "--out", outPath]);
        const text = readFileSync(outPath, "utf-8");
        expect(text).toContain("AUTO-GENERATED by script/gen-conf-fixture.mjs");
        expect(text).toContain("export { makeConf };");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});
