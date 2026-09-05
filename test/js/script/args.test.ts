import { describe, expect, it } from "vitest";
import { help, parseArgs } from "#script/args.mjs";

const SPEC = {
  dev: { type: "bool", short: "d" },
  check: { type: "bool" },
  root: { type: "string", default: "." },
  names: { type: "array" },
  limit: { type: "number", default: 10 },
};

describe("parseArgs", () => {
  describe("boolean flags", () => {
    it("sets flag to true", () => {
      expect(parseArgs(["--dev"], SPEC)).toMatchObject({ dev: true });
    });

    it("keeps flag false when not present", () => {
      expect(parseArgs([], SPEC)).toMatchObject({ dev: false });
    });

    it("rejects value on boolean flag", () => {
      const r = parseArgs(["--dev=yes"], SPEC);
      expect(r.errors).toContain("--dev is a boolean flag, does not take a value");
    });
  });

  describe("string values", () => {
    it("parses --root=path", () => {
      const r = parseArgs(["--root=/foo"], SPEC);
      expect(r.root).toBe("/foo");
    });

    it("parses --root path", () => {
      const r = parseArgs(["--root", "/bar"], SPEC);
      expect(r.root).toBe("/bar");
    });

    it("reports missing value", () => {
      const r = parseArgs(["--root"], SPEC);
      expect(r.errors).toContain("--root requires a value");
    });

    it("uses default value when absent", () => {
      expect(parseArgs([], SPEC).root).toBe(".");
    });
  });

  describe("number values", () => {
    it("coerces --limit=25 to a number", () => {
      const r = parseArgs(["--limit=25"], SPEC);
      expect(r.limit).toBe(25);
      expect(typeof r.limit).toBe("number");
    });

    it("keeps a fractional value", () => {
      // Truncating would silently widen a threshold band, so `--limit 15.5`
      // must arrive as 15.5 rather than 15.
      expect(parseArgs(["--limit=15.5"], SPEC).limit).toBe(15.5);
    });

    it("parses a positional value", () => {
      expect(parseArgs(["--limit", "20"], SPEC).limit).toBe(20);
    });

    it("reports a non-numeric value and keeps the default", () => {
      // Silently keeping the default would run the tool at a threshold the
      // user never asked for, so this is an error instead.
      const r = parseArgs(["--limit=abc"], SPEC);
      expect(r.limit).toBe(10);
      expect(r.errors).toContain("--limit must be a number: abc");
    });

    it("treats a blank value as an omission", () => {
      // `Number("")` is 0, which would masquerade as an explicit zero rather
      // than a mistake.
      const r = parseArgs(["--limit="], SPEC);
      expect(r.limit).toBe(10);
      expect(r.errors).toContain("--limit requires a value");
    });

    it("uses the default when the flag is absent", () => {
      expect(parseArgs([], SPEC).limit).toBe(10);
    });
  });

  describe("array flags", () => {
    it("collects repeated values", () => {
      const r = parseArgs(["--names=alice", "--names=bob"], SPEC);
      expect(r.names).toEqual(["alice", "bob"]);
    });

    it("collects positional values", () => {
      const r = parseArgs(["--names", "alice", "--names", "bob"], SPEC);
      expect(r.names).toEqual(["alice", "bob"]);
    });

    it("starts empty", () => {
      expect(parseArgs([], SPEC).names).toEqual([]);
    });
  });

  describe("short flags", () => {
    it("maps -d to --dev", () => {
      expect(parseArgs(["-d"], SPEC).dev).toBe(true);
    });

    it("reports unknown short flag", () => {
      const r = parseArgs(["-x"], SPEC);
      expect(r.errors).toContain("Unknown short flag: -x");
    });
  });

  describe("--help", () => {
    it("returns help=true for --help", () => {
      expect(parseArgs(["--help"], SPEC).help).toBe(true);
    });

    it("returns help=true for -h", () => {
      expect(parseArgs(["-h"], SPEC).help).toBe(true);
    });

    it("stops parsing after --help", () => {
      expect(parseArgs(["--help", "--dev"], SPEC).help).toBe(true);
    });
  });

  describe("unknown flags", () => {
    it("reports unknown flag", () => {
      const r = parseArgs(["--unknown"], SPEC);
      expect(r.errors).toContain("Unknown flag: --unknown");
    });

    it("reports unknown positional argument", () => {
      const r = parseArgs(["positional"], SPEC);
      expect(r.errors).toContain("Unknown argument: positional");
    });
  });

  describe("empty input", () => {
    it("returns all defaults with no errors", () => {
      const r = parseArgs([], SPEC);
      expect(r.errors).toEqual([]);
      expect(r.help).toBe(false);
      expect(r.dev).toBe(false);
      expect(r.check).toBe(false);
      expect(r.root).toBe(".");
      expect(r.limit).toBe(10);
      expect(r.names).toEqual([]);
    });
  });
});

describe("help", () => {
  it("renders usage header", () => {
    expect(help(SPEC)).toContain("Usage:");
  });

  it("includes all flags", () => {
    const output = help(SPEC);
    expect(output).toContain("--dev");
    expect(output).toContain("--check");
    expect(output).toContain("--root");
    expect(output).toContain("--names");
  });

  it("shows short flag alias", () => {
    expect(help(SPEC)).toContain("-d, --dev");
  });

  it("shows type hint for string", () => {
    expect(help(SPEC)).toContain("<path>");
  });

  it("shows type hint for number", () => {
    expect(help(SPEC)).toContain("--limit <n>");
  });

  it("shows [repeated] for array", () => {
    expect(help(SPEC)).toContain("[repeated]");
  });

  it("includes descriptions", () => {
    const spec2 = { verbose: { type: "bool", desc: "Verbose output" } };
    expect(help(spec2)).toContain("# Verbose output");
  });
});
