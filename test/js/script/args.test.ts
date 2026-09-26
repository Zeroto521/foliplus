import { describe, expect, it } from "vitest";
import { help, parseArgs } from "#script/args.mjs";

const SPEC = {
  dev: { type: "bool", short: "d" },
  check: { type: "bool" },
  root: { type: "string", default: "." },
  names: { type: "array" },
  limit: { type: "number", default: 10 },
};

type Args = {
  help: boolean;
  errors: string[];
  dev: boolean;
  check: boolean;
  root: string;
  names: string[];
  limit: number;
};

const args = (argv: string[] = []): Args => parseArgs(argv, SPEC) as unknown as Args;

describe("parseArgs", () => {
  describe("boolean flags", () => {
    it("sets flag to true", () => {
      expect(args(["--dev"])).toMatchObject({ dev: true });
    });

    it("keeps flag false when not present", () => {
      expect(args([])).toMatchObject({ dev: false });
    });

    it("rejects value on boolean flag", () => {
      const r = args(["--dev=yes"]);
      expect(r.errors).toContain("--dev is a boolean flag, does not take a value");
    });
  });

  describe("string values", () => {
    it("parses --root=path", () => {
      const r = args(["--root=/foo"]);
      expect(r.root).toBe("/foo");
    });

    it("parses --root path", () => {
      const r = args(["--root", "/bar"]);
      expect(r.root).toBe("/bar");
    });

    it("reports missing value", () => {
      const r = args(["--root"]);
      expect(r.errors).toContain("--root requires a value");
    });

    it("uses default value when absent", () => {
      expect(args([]).root).toBe(".");
    });
  });

  describe("number values", () => {
    it("coerces --limit=25 to a number", () => {
      const r = args(["--limit=25"]);
      expect(r.limit).toBe(25);
      expect(typeof r.limit).toBe("number");
    });

    it("keeps a fractional value", () => {
      // Truncating would silently widen a threshold band, so `--limit 15.5`
      // must arrive as 15.5 rather than 15.
      expect(args(["--limit=15.5"]).limit).toBe(15.5);
    });

    it("parses a positional value", () => {
      expect(args(["--limit", "20"]).limit).toBe(20);
    });

    it("reports a non-numeric value and keeps the default", () => {
      // Silently keeping the default would run the tool at a threshold the
      // user never asked for, so this is an error instead.
      const r = args(["--limit=abc"]);
      expect(r.limit).toBe(10);
      expect(r.errors).toContain("--limit must be a number: abc");
    });

    it("treats a blank value as an omission", () => {
      // `Number("")` is 0, which would masquerade as an explicit zero rather
      // than a mistake.
      const r = args(["--limit="]);
      expect(r.limit).toBe(10);
      expect(r.errors).toContain("--limit requires a value");
    });

    it("uses the default when the flag is absent", () => {
      expect(args([]).limit).toBe(10);
    });
  });

  describe("array flags", () => {
    it("collects repeated values", () => {
      const r = args(["--names=alice", "--names=bob"]);
      expect(r.names).toEqual(["alice", "bob"]);
    });

    it("collects positional values", () => {
      const r = args(["--names", "alice", "--names", "bob"]);
      expect(r.names).toEqual(["alice", "bob"]);
    });

    it("starts empty", () => {
      expect(args([]).names).toEqual([]);
    });
  });

  describe("short flags", () => {
    it("maps -d to --dev", () => {
      expect(args(["-d"]).dev).toBe(true);
    });

    it("reports unknown short flag", () => {
      const r = args(["-x"]);
      expect(r.errors).toContain("Unknown short flag: -x");
    });
  });

  describe("--help", () => {
    it("returns help=true for --help", () => {
      expect(args(["--help"]).help).toBe(true);
    });

    it("returns help=true for -h", () => {
      expect(args(["-h"]).help).toBe(true);
    });

    it("stops parsing after --help", () => {
      expect(args(["--help", "--dev"]).help).toBe(true);
    });
  });

  describe("unknown flags", () => {
    it("reports unknown flag", () => {
      const r = args(["--unknown"]);
      expect(r.errors).toContain("Unknown flag: --unknown");
    });

    it("reports unknown positional argument", () => {
      const r = args(["positional"]);
      expect(r.errors).toContain("Unknown argument: positional");
    });
  });

  describe("empty input", () => {
    it("returns all defaults with no errors", () => {
      const r = args([]);
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
