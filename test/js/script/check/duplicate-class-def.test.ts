// Guard test for `script/check/duplicate-class-def.mjs` — one owner per CSS
// class name. The script's pure checker `findDuplicateClassDefs` groups owner
// sites by the class name they spell and keeps the groups with more than one
// site; the const-map scanner `parseClassDefs` is the parser that feeds it.
//
// The red case below manufactures a duplicate in a throwaway tree and proves
// the checker finds it *without* touching `BASELINE_PENDING` — the pending
// list is a work queue of known deferrals, not an exemption the checker has
// been told to honour, so adding to it must never silence a new duplicate.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASELINE_PENDING,
  EXEMPTIONS,
  findDuplicateClassDefs,
  isExempt,
  isPending,
  main,
  parseClassDefs,
  runCli,
} from "#script/check/duplicate-class-def.mjs";

const REPO = process.cwd();
const PANEL_CLASS_FILE = path.join(REPO, "foliplus", "js", "ui", "panelClassName.ts");

/** Owner sites parsed out of the real panel vocabulary — the script's own
 *  parser reading the file the CLI reads. */
const realSites = () =>
  parseClassDefs(readFileSync(PANEL_CLASS_FILE, "utf8")).map(s => ({
    ...s,
    rel: "foliplus/js/ui/panelClassName.ts",
  }));

/** Build a throwaway `foliplus/js` tree with the given source files, so a
 *  duplicate can be injected without touching production. */
const tempRoot = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "duplicate-class-def-"));
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseClassDefs", () => {
  it("finds a camelCase key inside a class const map", () => {
    // The scheme picker owns DEFAULT_CLASSES.active in lowercase — the first
    // audit pass dropped it because it only looked at ALL_CAPS keys.
    const sites = parseClassDefs(
      'const DEFAULT_CLASSES = {\n  active: "foliplus-is-active",\n} as const;\n',
    );
    expect(sites).toEqual([
      { token: "foliplus-is-active", key: "active", owner: "DEFAULT_CLASSES", line: 2 },
    ]);
  });

  it("finds a file-level named const", () => {
    const sites = parseClassDefs('const HIDDEN_CLASS = "foliplus-hidden";\n');
    expect(sites).toEqual([
      { token: "foliplus-hidden", key: "HIDDEN_CLASS", owner: "HIDDEN_CLASS", line: 1 },
    ]);
  });

  it("ignores a composite value — one owner per name, not per string", () => {
    const sites = parseClassDefs(
      'const CLASSES = {\n  DOT: "foliplus-dot foliplus-dot-hollow",\n};\n',
    );
    expect(sites).toEqual([]);
  });

  it("ignores a selector string", () => {
    const sites = parseClassDefs(
      'const SEL = {\n  ITEM: ".foliplus-layer-item",\n};\n',
    );
    expect(sites).toEqual([]);
  });

  it("ignores a class name a doc comment merely names", () => {
    const sites = parseClassDefs(
      "/** see foliplus-hidden */\nconst OTHER = { X: 1 };\n",
    );
    expect(sites).toEqual([]);
  });

  it("ignores a longer name sharing the same prefix", () => {
    const sites = parseClassDefs(
      'const CLASSES = {\n  MODE: "foliplus-export-mode",\n};\n',
    );
    expect(sites.some(s => s.token === "foliplus-export")).toBe(false);
  });
});

describe("findDuplicateClassDefs", () => {
  it("groups owner sites that spell one class name", () => {
    const sites = [
      { token: "foliplus-hidden", key: "HIDDEN", owner: "A", line: 2, rel: "a.ts" },
      { token: "foliplus-hidden", key: "HIDDEN", owner: "B", line: 2, rel: "b.ts" },
    ];
    expect(findDuplicateClassDefs(sites)).toEqual([
      { token: "foliplus-hidden", sites },
    ]);
  });

  it("reports nothing when two files own two different names", () => {
    const sites = [
      { token: "foliplus-hidden", key: "HIDDEN", owner: "A", line: 2, rel: "a.ts" },
      { token: "foliplus-close-btn", key: "CLOSE", owner: "B", line: 3, rel: "b.ts" },
    ];
    expect(findDuplicateClassDefs(sites)).toEqual([]);
  });

  it("sorts by token so the report is stable", () => {
    const sites = [
      { token: "foliplus-z", key: "A", owner: "A", line: 2, rel: "a.ts" },
      { token: "foliplus-z", key: "B", owner: "B", line: 2, rel: "b.ts" },
      { token: "foliplus-a", key: "A", owner: "A", line: 2, rel: "a.ts" },
      { token: "foliplus-a", key: "B", owner: "B", line: 2, rel: "b.ts" },
    ];
    expect(findDuplicateClassDefs(sites).map(d => d.token)).toEqual([
      "foliplus-a",
      "foliplus-z",
    ]);
  });
});

describe("isPending", () => {
  it("rejects every duplicate when the pending list is empty", () => {
    // The audit's deferred work is done: BASELINE_PENDING is empty, so nothing
    // is deferred and a duplicate of any name is new work.
    const dup = {
      token: "foliplus-tool-btn",
      sites: [
        { rel: "foliplus/js/control/ExportControl/const.ts" },
        { rel: "foliplus/js/control/FullscreenControl/const.ts" },
      ],
    };
    expect(isPending(dup, BASELINE_PENDING)).toBe(false);
    expect(BASELINE_PENDING).toEqual([]);
  });

  it("rejects a listed duplicate that gained a third owner", () => {
    // A new site for a listed name is a *new* duplicate, so the pending
    // list must not swallow it.
    const pending = [
      {
        token: "foliplus-tool-btn",
        sites: [
          "foliplus/js/control/ExportControl/const.ts",
          "foliplus/js/control/FullscreenControl/const.ts",
        ],
      },
    ];
    const dup = {
      token: "foliplus-tool-btn",
      sites: [
        { rel: "foliplus/js/control/ExportControl/const.ts" },
        { rel: "foliplus/js/control/FullscreenControl/const.ts" },
        { rel: "foliplus/js/control/LocateControl/const.ts" },
      ],
    };
    expect(isPending(dup, pending)).toBe(false);
  });

  it("rejects a duplicate nobody has listed", () => {
    expect(
      isPending(
        { token: "foliplus-brand-new", sites: [{ rel: "a.ts" }, { rel: "b.ts" }] },
        BASELINE_PENDING,
      ),
    ).toBe(false);
  });

  it("accepts a listed duplicate whose owner files match exactly", () => {
    const pending = [
      {
        token: "foliplus-tool-btn",
        sites: [
          "foliplus/js/control/ExportControl/const.ts",
          "foliplus/js/control/FullscreenControl/const.ts",
        ],
      },
    ];
    const dup = {
      token: "foliplus-tool-btn",
      sites: [
        { rel: "foliplus/js/control/ExportControl/const.ts" },
        { rel: "foliplus/js/control/FullscreenControl/const.ts" },
      ],
    };
    expect(isPending(dup, pending)).toBe(true);
  });

  it("has no exemptions at all: an empty pending list clears nothing", () => {
    const dup = { token: "foliplus-x", sites: [{ rel: "a.ts" }, { rel: "b.ts" }] };
    expect(isPending(dup, [])).toBe(false);
  });
});

describe("isExempt", () => {
  it("accepts the measure-label exemption with its recorded owner file", () => {
    const dup = {
      token: "foliplus-measure-label",
      sites: [{ rel: "foliplus/js/control/MeasureControl/const.ts" }],
    };
    expect(isExempt(dup)).toBe(true);
    expect(EXEMPTIONS.some(e => e.token === "foliplus-measure-label")).toBe(true);
  });

  it("rejects an unlisted duplicate", () => {
    const dup = {
      token: "foliplus-brand-new",
      sites: [{ rel: "a.ts" }, { rel: "b.ts" }],
    };
    expect(isExempt(dup)).toBe(false);
  });

  it("rejects an exemption that gained a second owner file", () => {
    const dup = {
      token: "foliplus-measure-label",
      sites: [
        { rel: "foliplus/js/control/MeasureControl/const.ts" },
        { rel: "foliplus/js/control/SearchControl/const.ts" },
      ],
    };
    expect(isExempt(dup)).toBe(false);
  });

  it("the exemption list has a written reason for every entry", () => {
    for (const e of EXEMPTIONS) {
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.sites.length).toBeGreaterThan(0);
    }
  });
});

describe("duplicate-class-def CLI", () => {
  it("main returns 1 on a manufactured duplicate, with no pending list", () => {
    const dir = tempRoot({
      "foliplus/js/ui/panelClassName.ts":
        'const PANEL_CLASS = {\n  HIDDEN: "foliplus-hidden",\n} as const;\n',
      "foliplus/js/control/ExportControl/const.ts":
        'const CLASSES = {\n  HIDDEN: "foliplus-hidden",\n};\n',
    });
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      log.push(args.join(" "));
    });
    try {
      expect(main(["--check"], dir)).toBe(1);
      expect(
        log.some(l => l.includes("foliplus-hidden") && l.includes("BLOCKING")),
      ).toBe(true);
      expect(log.some(l => l.includes("one owner"))).toBe(true);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("main returns 0 when the only duplicate is a listed exemption", () => {
    const dir = tempRoot({
      "foliplus/js/control/MeasureControl/const.ts":
        'const LABEL = {\n  CLASS: "foliplus-measure-label",\n};\nconst PANES = {\n  LABEL: "foliplus-measure-label",\n};\n',
    });
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      log.push(args.join(" "));
    });
    try {
      expect(main(["--check"], dir)).toBe(0);
      expect(log.some(l => l.includes("deferred"))).toBe(true);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("main returns 0 without --check even when the real tree has duplicates", () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      log.push(args.join(" "));
    });
    try {
      expect(main([], REPO)).toBe(0);
      expect(log.some(l => l.includes("owner sites scanned"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("reports the real panel vocabulary as the sole owner of foliplus-hidden", () => {
    // The whole point of the change under test: nothing else may spell it.
    const hidden = realSites().filter(s => s.token === "foliplus-hidden");
    expect(hidden).toHaveLength(1);
    expect(hidden[0].key).toBe("HIDDEN");
  });

  it("runCli wires main to process.exitCode only when this file is the entry", () => {
    const original = process.exitCode;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      runCli(path.join("elsewhere", "other.mjs"));
      expect(process.exitCode).toBe(original ?? undefined);
    } finally {
      spy.mockRestore();
    }
  });
});
