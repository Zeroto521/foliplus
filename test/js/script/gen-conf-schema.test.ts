import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfSchema, main } from "#script/gen-conf-schema.mjs";

const SHORT_NOTE = "short";
const LONG_NOTE =
  "This field is set by JavaScript at runtime and never emitted by Python.";

// A minimal but representative schema dump (shape matches foliplus/_schema.py).
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
  },
};

describe("buildConfSchema", () => {
  it("per-control interfaces extend ConfShared", async () => {
    const text = await buildConfSchema(schema);
    expect(text).toContain("interface ConfFullscreen extends ConfShared {");
    expect(text).toContain("interface ConfScale extends ConfShared {");
    expect(text).toContain("interface ConfSearch extends ConfShared {");
  });

  it("keeps ConfShared and ConfRuntimeOnly standalone", async () => {
    const text = await buildConfSchema(schema);
    expect(text).toMatch(/interface ConfShared \{\n  name: string;/);
    // No `extends` on either standalone interface.
    expect(text).not.toContain("interface ConfShared extends");
    expect(text).not.toContain("interface ConfRuntimeOnly extends");
  });

  it("flat ComponentConfig: all fields optional except name, plus escape hatch", async () => {
    const text = await buildConfSchema(schema);
    expect(text).toMatch(/interface ComponentConfig \{\n  name: string;/);
    expect(text).toContain("hide_self?: boolean;");
    expect(text).toContain("position?: ControlPosition;");
    expect(text).toContain("  [key: string]: unknown;");
  });

  it("renders union and nullable types", async () => {
    const text = await buildConfSchema(schema);
    expect(text).toContain('mode: "coord" | "addr";');
    expect(text).toContain("provider_config?: Record<string, unknown> | null;");
  });

  it("emits a single bottom export type block", async () => {
    const text = await buildConfSchema(schema);
    const tail = text.slice(text.indexOf("export type"));
    expect(tail).toContain("ConfShared");
    expect(tail).toContain("ConfFullscreen");
    expect(tail).toContain("ConfScale");
    expect(tail).toContain("ConfSearch");
    expect(tail).toContain("ConfRuntimeOnly");
    expect(tail).toContain("ComponentConfig");
    // No inline exports anywhere else.
    expect(text.indexOf("export type")).toBe(text.lastIndexOf("export type"));
  });

  it("renders a short single-line note as a trailing comment", async () => {
    const text = await buildConfSchema(schema);
    expect(text).toContain("short_note?: string; // short");
  });

  it("renders a long note as a JSDoc block above the field", async () => {
    // Dropping the note was the failure mode this guards against: a note that
    // would wrap badly in a trailing comment becomes a block instead.
    const text = await buildConfSchema(schema);
    const block = text
      .split("\n")
      .find(l => l.includes(LONG_NOTE) && l.trim().startsWith("/**"));
    expect(block).toBeDefined();
    expect(text).not.toContain("long_note?: string; //");
  });

  it("throws on a union without values", async () => {
    const bad = { ...schema, shared: { mode: { ts: "union", values: [] } } };
    await expect(buildConfSchema(bad)).rejects.toThrow("non-empty values");
  });

  it("throws on an unknown ts tag", async () => {
    const bad = { ...schema, shared: { bogus: { ts: "bogus" } } };
    await expect(buildConfSchema(bad)).rejects.toThrow("Unknown FieldSpec.ts tag");
  });

  it("is deterministic across calls", async () => {
    const a = await buildConfSchema(schema);
    const b = await buildConfSchema(schema);
    expect(a).toBe(b);
  });
});

describe("main", () => {
  let dir: string | undefined;
  let jsonPath: string;
  let outPath: string;

  const withTmp = () => {
    dir = mkdtempSync(join(tmpdir(), "gen-conf-schema-"));
    jsonPath = join(dir, "conf-schema.json");
    outPath = join(dir, "conf-schema.ts");
    writeFileSync(jsonPath, JSON.stringify(schema), "utf-8");
  };

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes the generated file in write mode", async () => {
    withTmp();
    await main({ json: jsonPath, out: outPath });
    const text = readFileSync(outPath, "utf-8");
    expect(text).toContain("AUTO-GENERATED by script/gen-conf-schema.mjs");
    expect(text).toContain("interface ConfSearch extends ConfShared {");
    expect(text).toContain("export type {");
  });

  it("verify accepts a CRLF checkout copy of the generated file", async () => {
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
  });

  it("verify reports a stale file and exits 1", async () => {
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
        "foliplus/js/conf-schema.ts is out of date",
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
