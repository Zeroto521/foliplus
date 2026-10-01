import { describe, expect, it } from "vitest";
import { buildConfFixture } from "#script/gen-conf-fixture.mjs";

// Shape matches foliplus/_schema.py's dump. Two controls share the `filename`
// key with different defaults — the regression the per-control grouping fixes.
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
  },
};

describe("buildConfFixture", () => {
  it("groups defaults per control — no cross-control collision", async () => {
    const text = await buildConfFixture(schema);
    // Both filename defaults survive; the earlier one no longer overwrites.
    expect(text).toMatch(/ExportControl: \{\n    filename: "map"/);
    expect(text).toMatch(/MeasureControl: \{\n    filename: "measurements"/);
  });

  it("serializes explicit null defaults as null", async () => {
    const text = await buildConfFixture(schema);
    expect(text).toMatch(/provider_config: null,/);
  });

  it("makeConf takes controlName and merges overrides last", async () => {
    const text = await buildConfFixture(schema);
    expect(text).toContain("function makeConf(");
    expect(text).toContain("controlName: string,");
    expect(text).toContain("overrides?: Partial<ComponentConfig>,");
    expect(text).toMatch(/name: controlName,/);
    expect(text).toContain("...CONF_DEFAULTS[controlName],");
    expect(text).toContain("...overrides,");
  });

  it("exports makeConf via a bottom aggregate block", async () => {
    const text = await buildConfFixture(schema);
    const tail = text.slice(text.indexOf("export {"));
    expect(tail).toContain("export { makeConf };");
    // No inline export on the function declaration itself.
    expect(text).not.toContain("export function makeConf");
  });

  it("is deterministic across calls", async () => {
    const a = await buildConfFixture(schema);
    const b = await buildConfFixture(schema);
    expect(a).toBe(b);
  });
});
