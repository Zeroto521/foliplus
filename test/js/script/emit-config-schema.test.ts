import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrettierOptions,
  buildConfigSchema,
  main,
} from "#script/emit-config-schema.mjs";

const SHORT_NOTE = "short";
const LONG_NOTE =
  "This field is set by JavaScript at runtime and never emitted by Python.";

// buildConfigSchema hands its output to prettier with the repo config, so a single
// call can take several seconds. Under the full suite's parallel load the first
// one in a file exceeded the default 5 s budget and failed at the `it(` line,
// which said nothing about the schema — the same situation
// bundle-size-check.test.ts handles with SLOW. Assertions are unchanged.
const SLOW = 30000;

// A minimal but representative schema dump (shape matches foliplus/_config_schema.py).
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
    position: {
      ts: "control_position",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
    },
    locale_tables: {
      ts: "locale_tables",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
    },
    short_note: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
      note: SHORT_NOTE,
    },
    long_note: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
      note: LONG_NOTE,
    },
    // Short but multi-line: the trailing-comment test also needs a line break,
    // so the JSDoc block branch fires on either trigger independently.
    multi_line_note: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
      note: "first line\nsecond line",
    },
  },
  runtime_only: {
    field: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: true,
      dynamic: false,
    },
    background: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: true,
      dynamic: false,
    },
    // Repeats a shared field: the third merge pass must skip it, so the flat
    // type keeps ConfigCommon's declaration.
    position: {
      ts: "string",
      optional: true,
      nullable: false,
      runtime_only: true,
      dynamic: false,
    },
  },
  controls: {
    FullscreenControl: {
      hide_self: {
        ts: "bool",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: true,
      },
      hide_others: {
        ts: "bool",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: true,
      },
    },
    ScaleControl: {
      show_zoom: {
        ts: "bool",
        optional: false,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: true,
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
    // Shares `position` with `schema.shared` — the first merge pass wins, so the
    // control's spelling must not leak into the flat ComponentConfig.
    CollisionControl: {
      position: {
        ts: "string",
        optional: true,
        nullable: false,
        runtime_only: false,
        dynamic: false,
      },
    },
  },
};

describe("PrettierOptions", () => {
  it("resolves the repo config so format() agrees with format:check", () => {
    // resolveConfig() needs a *file* path: for a directory it searches from
    // that directory's parent, which found a sibling checkout's config
    // locally and nothing in CI, leaving format() on bare prettier defaults.
    // The build's byte-exact verify then rejected that output with a
    // misleading "config-schema.ts is out of date" message pointing at
    // _config_schema.py.
    const config = PrettierOptions as unknown as Record<string, unknown>;
    expect(Object.keys(config).length).toBeGreaterThan(0);
    expect(Array.isArray(config.plugins)).toBe(true);
    expect((config.plugins as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(config.importOrder)).toBe(true);
  });

  it("falls back to {} when resolveConfig returns null", async () => {
    vi.doMock("prettier", () => ({
      resolveConfig: vi.fn().mockResolvedValue(null),
      format: vi.fn().mockResolvedValue("formatted"),
    }));
    vi.resetModules();
    try {
      const mod = await import("#script/emit-config-schema.mjs");
      expect(mod.PrettierOptions).toEqual({});
    } finally {
      vi.doUnmock("prettier");
      vi.resetModules();
    }
  });
});

describe("buildConfigSchema", () => {
  it(
    "per-control interfaces extend ConfigCommon",
    async () => {
      const text = await buildConfigSchema(schema);
      expect(text).toContain("interface ConfigFullscreen extends ConfigCommon {");
      expect(text).toContain("interface ConfigScale extends ConfigCommon {");
      expect(text).toContain("interface ConfigSearch extends ConfigCommon {");
    },
    SLOW,
  );

  it(
    "keeps ConfigCommon and ConfigRuntimeOnly standalone",
    async () => {
      const text = await buildConfigSchema(schema);
      expect(text).toMatch(/interface ConfigCommon \{\n  name: string;/);
      // No `extends` on either standalone interface.
      expect(text).not.toContain("interface ConfigCommon extends");
      expect(text).not.toContain("interface ConfigRuntimeOnly extends");
    },
    SLOW,
  );

  it(
    "flat ComponentConfig: all fields optional except name, plus escape hatch",
    async () => {
      const text = await buildConfigSchema(schema);
      expect(text).toMatch(/interface ComponentConfig \{\n  name: string;/);
      expect(text).toContain("hide_self?: boolean;");
      expect(text).toContain("position?: ControlPosition;");
      expect(text).toContain("  [key: string]: unknown;");
    },
    SLOW,
  );

  it(
    "flat ComponentConfig keeps the first declaration on a name collision",
    async () => {
      // shared merges before controls and runtime_only, so ConfigCommon's type wins
      // and the duplicate declarations never reach the flat type. Scoped to the
      // flat block: ConfigCollision legitimately carries its own `position` spelling.
      const text = await buildConfigSchema(schema);
      const flat = text.slice(text.indexOf("interface ComponentConfig"));
      expect(flat).toContain("position?: ControlPosition;");
      expect(flat).not.toContain("position?: string;");
    },
    SLOW,
  );

  it(
    "renders union and nullable types",
    async () => {
      const text = await buildConfigSchema(schema);
      expect(text).toContain('mode: "coord" | "addr";');
      expect(text).toContain("provider_config?: Record<string, unknown> | null;");
    },
    SLOW,
  );

  it(
    "emits a single bottom export type block",
    async () => {
      const text = await buildConfigSchema(schema);
      const tail = text.slice(text.indexOf("export type"));
      expect(tail).toContain("ConfigCommon");
      expect(tail).toContain("ConfigFullscreen");
      expect(tail).toContain("ConfigScale");
      expect(tail).toContain("ConfigSearch");
      expect(tail).toContain("ConfigRuntimeOnly");
      expect(tail).toContain("ComponentConfig");
      // No inline exports anywhere else.
      expect(text.indexOf("export type")).toBe(text.lastIndexOf("export type"));
    },
    SLOW,
  );

  it(
    "renders a short single-line note as a trailing comment",
    async () => {
      const text = await buildConfigSchema(schema);
      expect(text).toContain("short_note?: string; // short");
    },
    SLOW,
  );

  it(
    "renders a long note as a JSDoc block above the field",
    async () => {
      // Dropping the note was the failure mode this guards against: a note that
      // would wrap badly in a trailing comment becomes a block instead.
      const text = await buildConfigSchema(schema);
      const block = text
        .split("\n")
        .find(l => l.includes(LONG_NOTE) && l.trim().startsWith("/**"));
      expect(block).toBeDefined();
      expect(text).not.toContain("long_note?: string; //");
    },
    SLOW,
  );

  it(
    "renders a short multi-line note as a JSDoc block",
    async () => {
      // A line break forces the block form even when the note is short: a wrapped
      // trailing comment would silently keep only the first line.
      const text = await buildConfigSchema(schema);
      expect(text).toContain("/** first line");
      expect(text).toContain("second line */");
      expect(text).not.toContain("multi_line_note?: string; //");
    },
    SLOW,
  );

  it("throws on a union without values", async () => {
    const bad = { ...schema, shared: { mode: { ts: "union", values: [] } } };
    await expect(buildConfigSchema(bad)).rejects.toThrow("non-empty values");
  });

  it("throws on an unknown ts tag", async () => {
    const bad = { ...schema, shared: { bogus: { ts: "bogus" } } };
    await expect(buildConfigSchema(bad)).rejects.toThrow("Unknown FieldSpec.ts tag");
  });

  it(
    "is deterministic across calls",
    async () => {
      const a = await buildConfigSchema(schema);
      const b = await buildConfigSchema(schema);
      expect(a).toBe(b);
    },
    SLOW,
  );
});

describe("main", () => {
  let dir: string | undefined;
  let jsonPath: string;
  let outPath: string;

  const withTmp = () => {
    dir = mkdtempSync(join(tmpdir(), "config-schema-"));
    jsonPath = join(dir, "config-schema.json");
    outPath = join(dir, "config-schema.ts");
    writeFileSync(jsonPath, JSON.stringify(schema), "utf-8");
  };

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "writes the generated file in write mode",
    async () => {
      withTmp();
      await main({ json: jsonPath, out: outPath });
      const text = readFileSync(outPath, "utf-8");
      expect(text).toContain("AUTO-GENERATED by script/emit-config-schema.mjs");
      expect(text).toContain("interface ConfigSearch extends ConfigCommon {");
      expect(text).toContain("export type {");
    },
    SLOW,
  );

  it(
    "verify accepts a CRLF checkout copy of the generated file",
    async () => {
      // git autocrlf re-emits CRLF on Windows checkouts while prettier emits LF,
      // so a raw byte compare failed locally and passed in CI.
      withTmp();
      await main({ json: jsonPath, out: outPath });
      writeFileSync(
        outPath,
        readFileSync(outPath, "utf-8").replace(/\n/g, "\r\n"),
        "utf-8",
      );
      await expect(main({ json: jsonPath, out: outPath, verify: true })).resolves.toBe(
        undefined,
      );
    },
    SLOW,
  );

  it(
    "verify reports a stale file and exits 1",
    async () => {
      withTmp();
      writeFileSync(outPath, "stale\n", "utf-8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit:1");
      });
      try {
        await expect(
          main({ json: jsonPath, out: outPath, verify: true }),
        ).rejects.toThrow("exit:1");
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy.mock.calls.join("\n")).toContain(
          "foliplus/js/config-schema.ts is out of date",
        );
      } finally {
        errorSpy.mockRestore();
        exitSpy.mockRestore();
      }
    },
    SLOW,
  );

  it(
    "reads from stdin when --json is omitted",
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "config-schema-stdin-"));
      const outPath = join(tmp, "config-schema.ts");
      const readFileSyncMock = vi.fn((p: number | string) => {
        if (p === 0) return JSON.stringify(schema);
        return "";
      });
      const writeFileSyncMock = vi.fn();

      vi.doMock("fs", () => ({
        default: { readFileSync: readFileSyncMock, writeFileSync: writeFileSyncMock },
        readFileSync: readFileSyncMock,
        writeFileSync: writeFileSyncMock,
      }));
      vi.doMock("prettier", () => ({
        resolveConfig: vi.fn().mockResolvedValue(null),
        format: vi.fn().mockResolvedValue("formatted"),
      }));
      vi.resetModules();
      try {
        const mod = await import("#script/emit-config-schema.mjs");
        await mod.main({ out: outPath });
        expect(readFileSyncMock).toHaveBeenCalledWith(0, "utf-8");
        expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.doUnmock("fs");
        vi.doUnmock("prettier");
        vi.resetModules();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe("CLI entry", () => {
  // `parseArgs(process.argv.slice(2))` and the self-detection guard both run at
  // import time, so they are only reachable by re-importing the module with
  // argv replaced. vi.resetModules() re-runs the module body; trapping
  // process.exit turns the exit into a rejection instead of killing the worker.
  const SCRIPT = resolve(process.cwd(), "script", "emit-config-schema.mjs");

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
      return await import("#script/emit-config-schema.mjs");
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
      const tmp = mkdtempSync(join(tmpdir(), "config-schema-cli-"));
      const jsonPath = join(tmp, "config-schema.json");
      const outPath = join(tmp, "config-schema.ts");
      writeFileSync(jsonPath, JSON.stringify(schema), "utf-8");
      try {
        await runCli(["node", SCRIPT, "--json", jsonPath, "--out", outPath]);
        const text = readFileSync(outPath, "utf-8");
        expect(text).toContain("AUTO-GENERATED by script/emit-config-schema.mjs");
        expect(text).toContain("interface ConfigCommon {");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});
