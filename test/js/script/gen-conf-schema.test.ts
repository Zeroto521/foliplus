import { describe, expect, it } from "vitest";
import { buildConfSchema } from "#script/gen-conf-schema.mjs";

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

  it("is deterministic across calls", async () => {
    const a = await buildConfSchema(schema);
    const b = await buildConfSchema(schema);
    expect(a).toBe(b);
  });
});
