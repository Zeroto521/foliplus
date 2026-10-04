import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrettierOptions,
  buildConfigSchema,
  collectNamedTypes,
  main,
  renderShape,
} from "#script/build/emit-config-schema.mjs";

const SHORT_NOTE = "short";
const LONG_NOTE =
  "This field is set by JavaScript at runtime and never emitted by Python.";

// buildConfigSchema hands its output to prettier with the repo config, so a single
// call can take several seconds. Under the full suite's parallel load the first
// one in a file exceeded the default 5 s budget and failed at the `it(` line,
// which said nothing about the schema — the same situation
// bundle-size-check.test.ts handles with SLOW. Assertions are unchanged.
const SLOW = 30000;

// Alias declarations are long enough that prettier wraps them; collapse the
// output to one line so an assertion checks content, not layout.
const oneLine = (text: string) => text.replace(/\s+/g, " ");

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
      ts: "ControlPosition",
      optional: true,
      nullable: false,
      runtime_only: false,
      dynamic: false,
    },
    locale_tables: {
      ts: "object_nested",
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
      // A named, shape-driven type: exercises the alias declaration and the
      // single export block it must land in.
      entries: {
        ts: "LayerData",
        name: "LayerData",
        shape: [{ name: "string", id: "string", group: ["base", "overlay"] }],
        optional: true,
        nullable: false,
        runtime_only: false,
        dynamic: false,
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
        ts: "ProviderConfig",
        name: "ProviderConfig",
        shape: {
          id: "string",
          baseUrl: ["string", "?"],
          headers: [{ "*": "string" }, "?"],
          params: [{ "*": ["string", "number"] }, "?"],
        },
        optional: true,
        nullable: true,
        runtime_only: false,
        dynamic: false,
        default: null,
      },
    },
    // A named type driven by `values` rather than `shape` — the union half of
    // collectNamedTypes, mirroring HeatmapControl.label_format.
    HeatmapControl: {
      label_format: {
        ts: "union",
        name: "NumberStyle",
        values: ["auto", "int", "comma"],
        optional: true,
        nullable: false,
        runtime_only: false,
        dynamic: false,
        default: "auto",
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

// renderShape is the grammar for FieldSpec.shape. It is driven directly here
// rather than through buildConfigSchema: each of those calls costs a prettier
// pass, and the grammar cases are about the rendered string, not the layout.
describe("renderShape", () => {
  it("renders primitives and null", () => {
    expect(renderShape("string")).toBe("string");
    expect(renderShape("number")).toBe("number");
    expect(renderShape("bool")).toBe("boolean");
    expect(renderShape(null)).toBe("null");
  });

  it("renders a list of primitive names as an unquoted primitive union", () => {
    expect(renderShape(["string", "number"])).toBe("string | number");
    expect(renderShape(["bool", "null"])).toBe("boolean | null");
  });

  it("keeps a mixed or single-element list a quoted literal union", () => {
    expect(renderShape(["base", "overlay"])).toBe('"base" | "overlay"');
    expect(renderShape(["string", "base"])).toBe('"string" | "base"');
    expect(renderShape(["string"])).toBe('"string"');
  });

  it("treats Object.prototype names as literal values, not primitives", () => {
    // Own-property lookup only: `in` or `[]` would resolve "constructor" to
    // Object's constructor through the prototype chain. Even a genuine
    // primitive in the same list must not rescue it into primitive-union form:
    // the whole list degrades to a literal union instead.
    expect(renderShape(["constructor", "number"])).toBe('"constructor" | "number"');
    expect(renderShape(["toString", "bool"])).toBe('"toString" | "bool"');
  });

  it("renders a list whose item is not a string as an array", () => {
    expect(renderShape([{ id: "string" }])).toBe("{ id: string }[]");
    expect(renderShape([[{ id: "string" }]])).toBe("{ id: string }[][]");
  });

  it("parenthesizes a union used as an array item type", () => {
    expect(renderShape([["string", "number"]])).toBe("(string | number)[]");
    expect(renderShape([["base", "overlay"]])).toBe('("base" | "overlay")[]');
    // A union nested inside an object member does not make the object a union,
    // so the object itself stays unparenthesized.
    expect(renderShape([{ group: ["base", "overlay"] }])).toBe(
      '{ group: "base" | "overlay" }[]',
    );
  });

  it("renders a Record whose value is a primitive union", () => {
    expect(renderShape({ "*": ["string", "number"] })).toBe(
      "Record<string, string | number>",
    );
  });

  it("renders a sole '*' key as a Record", () => {
    expect(renderShape({ "*": "string" })).toBe("Record<string, string>");
  });

  it("renders named keys with the optional marker and a null value", () => {
    expect(renderShape({ id: "string", tag: ["string", "?"], stamp: null })).toBe(
      "{ id: string; tag?: string; stamp: null }",
    );
  });

  it("renders an optional Record nested in an object", () => {
    expect(renderShape({ headers: [{ "*": "string" }, "?"] })).toBe(
      "{ headers?: Record<string, string> }",
    );
  });

  it("rejects the optional marker outside a dict value, naming the path", () => {
    expect(() => renderShape(["string", "?"], "ProviderConfig.baseUrl")).toThrow(
      'Optional marker (X, "?") at ProviderConfig.baseUrl is only valid as a dict value',
    );
  });

  it("rejects a shape value with no known type, naming the path", () => {
    expect(() => renderShape(42, "ProviderConfig.id")).toThrow(
      "Unknown shape type at ProviderConfig.id: number",
    );
  });

  it("rejects an unknown primitive name, naming the path", () => {
    // Mirrors _validate_shape's message on the Python side, which sorts the
    // accepted names.
    expect(() => renderShape("integer", "T.count")).toThrow(
      'Unknown shape primitive "integer" at T.count — expected one of ' +
        "bool, null, number, string",
    );
    // A prototype-chain name must take this path too, not resolve to Object's
    // constructor and be returned as if it were a TS primitive.
    expect(() => renderShape("constructor", "T.count")).toThrow(
      'Unknown shape primitive "constructor" at T.count',
    );
  });
});

describe("collectNamedTypes", () => {
  it("maps each named field to its rendered type, shape- or union-driven", () => {
    const named = collectNamedTypes(schema);
    expect([...named.keys()].sort()).toEqual([
      "LayerData",
      "NumberStyle",
      "ProviderConfig",
    ]);
    // No prettier here: this is the raw grammar output before layout.
    expect(named.get("LayerData")).toBe(
      '{ name: string; id: string; group: "base" | "overlay" }[]',
    );
    expect(named.get("ProviderConfig")).toBe(
      "{ id: string; baseUrl?: string; headers?: Record<string, string>; params?: Record<string, string | number> }",
    );
    expect(named.get("NumberStyle")).toBe('"auto" | "int" | "comma"');
  });

  it("skips a named field that has no renderable descriptor", () => {
    // The dumper cannot produce this — derive_schema requires a shape for a
    // named non-union type — but a hand-edited dump would reach the branch:
    // renderType still renders the name, so the missing alias surfaces as a
    // "Cannot find name" typecheck error rather than a silent bad type.
    const orphan = {
      version: 1,
      shared: {},
      runtime_only: {},
      controls: {
        SearchControl: {
          provider_config: { ts: "ProviderConfig", name: "ProviderConfig" },
        },
      },
    };
    expect(collectNamedTypes(orphan).size).toBe(0);
  });
});

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
      const mod = await import("#script/build/emit-config-schema.mjs");
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
      expect(text).toContain("provider_config?: ProviderConfig | null;");
      expect(text).toContain("entries?: LayerData;");
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
      // Named aliases are declared without `export` and re-exported here.
      expect(tail).toContain("LayerData");
      expect(tail).toContain("ProviderConfig");
      // No inline exports anywhere else.
      expect(text.indexOf("export type")).toBe(text.lastIndexOf("export type"));
      expect(text).not.toContain("export type LayerData");
      expect(text).not.toContain("export type ProviderConfig");
    },
    SLOW,
  );

  it(
    "declares each named alias once and lets fields reference it by name",
    async () => {
      const text = await buildConfigSchema(schema);
      const flat = oneLine(text);
      expect(text.match(/^type \w+ = /gm)).toHaveLength(3);
      expect(flat).toContain(
        'type LayerData = { name: string; id: string; group: "base" | "overlay" }[];',
      );
      expect(flat).toContain(
        "type ProviderConfig = { id: string; baseUrl?: string; headers?: Record<string, string>; params?: Record<string, string | number>; };",
      );
      expect(flat).toContain('type NumberStyle = "auto" | "int" | "comma";');
      // The field carries the alias, not an inlined copy of its shape.
      expect(flat).toContain("label_format?: NumberStyle;");
      expect(flat).not.toContain("label_format?: {");
    },
    SLOW,
  );

  it(
    "emits no alias block when no field declares a name",
    async () => {
      const bare = {
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
          FullscreenControl: {
            hide_self: {
              ts: "bool",
              optional: false,
              nullable: false,
              runtime_only: false,
              dynamic: false,
              default: true,
            },
          },
        },
      };
      const text = await buildConfigSchema(bare);
      expect(text).not.toMatch(/^type \w+ = /m);
      expect(oneLine(text)).toContain(
        "export type { ConfigCommon, ConfigFullscreen, ConfigRuntimeOnly, ComponentConfig };",
      );
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
      expect(text).toContain("AUTO-GENERATED by script/build/emit-config-schema.mjs");
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
        default: {
          existsSync,
          readFileSync: readFileSyncMock,
          writeFileSync: writeFileSyncMock,
        },
        existsSync,
        readFileSync: readFileSyncMock,
        writeFileSync: writeFileSyncMock,
      }));
      vi.doMock("prettier", () => ({
        resolveConfig: vi.fn().mockResolvedValue(null),
        format: vi.fn().mockResolvedValue("formatted"),
      }));
      vi.resetModules();
      try {
        const mod = await import("#script/build/emit-config-schema.mjs");
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
  const SCRIPT = resolve(process.cwd(), "script", "build", "emit-config-schema.mjs");

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
      return await import("#script/build/emit-config-schema.mjs");
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
        expect(text).toContain("AUTO-GENERATED by script/build/emit-config-schema.mjs");
        expect(text).toContain("interface ConfigCommon {");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});
