// Guard test for `script/check/popup-placement.mjs` — a popup's coordinates,
// flip marker and placement viewport metrics live only in a shared adapter.
//
// The red cases are manufactured in a throwaway tree (via --root), never in the
// repo, so the lint chain stays green while this file is being written. The
// green case runs the real repo and proves the baseline is clean.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADAPTER_FILES,
  main,
  scan,
  scanSource,
  walkTs,
} from "#script/check/popup-placement.mjs";

/** Build a throwaway repo tree with the given source files. */
const roots: string[] = [];
const tempRoot = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "popup-placement-"));
  roots.push(dir);
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return dir;
};

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

const findingOf = (rel: string, source: string) => scanSource(rel, source).findings;

describe("walkTs", () => {
  it("collects .ts files under the production root and skips other suffixes", () => {
    const root = tempRoot({
      "foliplus/js/ui/a.ts": "",
      "foliplus/js/core/b.ts": "",
      "foliplus/js/ui/c.mjs": "",
      "foliplus/js/ui/d.css": "",
    });
    const found = walkTs(path.join(root, "foliplus/js")).map(file =>
      path.relative(root, file).split(path.sep).join("/"),
    );
    expect(found.sort()).toEqual(["foliplus/js/core/b.ts", "foliplus/js/ui/a.ts"]);
  });

  it("returns an empty list for a directory that does not exist", () => {
    const root = tempRoot({});
    expect(walkTs(path.join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("scanSource — violations", () => {
  it("reports a popup coordinate write outside an adapter", () => {
    const findings = findingOf("foliplus/js/ui/form.ts", 'el.style.top = "1px";\n');
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("coordinate");
    expect(findings[0].line).toBe(1);
  });

  it("reports a flip marker write outside an adapter", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      'el.dataset.side = "above";\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("flip-marker");
  });

  it("reports a viewport metric used for placement outside an adapter", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      "const height = window.innerHeight - 8;\n",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("viewport-metric");
  });

  it("reports the bracket and setProperty coordinate forms", () => {
    expect(
      findingOf("foliplus/js/ui/form.ts", 'el.style["top"] = "1px";\n')[0].rule,
    ).toBe("coordinate");
    expect(
      findingOf("foliplus/js/ui/form.ts", 'el.style.setProperty("left", "1px");\n')[0]
        .rule,
    ).toBe("coordinate");
  });

  it("reports the attribute form of the flip marker", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      'el.setAttribute("data-side", "above");\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("flip-marker");
  });

  it("ignores a prose mention inside a comment", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      "// el.style.top is written by the shell, not here.\n",
    );
    expect(findings).toEqual([]);
  });
});

describe("scanSource — exemptions", () => {
  it("accepts a same-line exemption with a reason", () => {
    const result = scanSource(
      "foliplus/js/ui/form.ts",
      'canvas.style.left = "0px"; // placement-adapter: map pan\n',
    );
    expect(result.findings).toEqual([]);
    expect(result.exemptions).toHaveLength(1);
    expect(result.exemptions[0].reason).toBe("map pan");
  });

  it("accepts a reason on the line directly above the write", () => {
    const result = scanSource(
      "foliplus/js/ui/form.ts",
      '// placement-adapter: offscreen probe\nel.style.top = "1px";\n',
    );
    expect(result.findings).toEqual([]);
    expect(result.exemptions).toHaveLength(1);
  });

  it("does not apply an exemption through an intervening code line", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      '// placement-adapter: not this line\nconst other = 1;\nel.style.top = "1px";\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("coordinate");
  });

  it("ignores a write inside a block comment", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      '/* el.style.top = "1px"; */\nconst ok = 1;\n',
    );
    expect(findings).toEqual([]);
  });

  it("treats an exemption without a reason as a violation", () => {
    const findings = findingOf(
      "foliplus/js/ui/form.ts",
      '// placement-adapter\nel.style.top = "1px";\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("exemption-without-reason");
  });
});

describe("scan — adapter allow-list", () => {
  it("does not report the same write inside an adapter file", () => {
    expect(ADAPTER_FILES.has("foliplus/js/ui/placement.ts")).toBe(true);
    const root = tempRoot({
      "foliplus/js/ui/placement.ts": 'el.style.top = "1px";\n',
    });
    expect(scan(root).findings).toEqual([]);
  });

  it("reports an allow-listed adapter that does not reference the kernel", () => {
    const root = tempRoot({
      "foliplus/js/ui/listbox.ts":
        '// computePlacement is mentioned here only in prose\nel.style.left = "1px";\n',
    });
    const findings = scan(root).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("adapter-without-kernel");
    expect(findings[0].file).toBe("foliplus/js/ui/listbox.ts");
  });

  it("accepts an adapter that uses the kernel and writes coordinates", () => {
    const root = tempRoot({
      "foliplus/js/ui/listbox.ts":
        'import { computePlacement } from "./placement.js";\n' +
        'const p = computePlacement(a, s, b);\nel.style.left = "1px";\n' +
        "const w = window.innerWidth;\n",
    });
    expect(scan(root).findings).toEqual([]);
  });

  it("counts the exempted lines it skipped", () => {
    const root = tempRoot({
      "foliplus/js/ui/form.ts": 'el.style.top = "1px"; // placement-adapter: form\n',
    });
    const result = scan(root);
    expect(result.findings).toEqual([]);
    expect(result.exemptions).toHaveLength(1);
  });
});

describe("main", () => {
  it("exits 0 without --check and 1 with it when a violation exists", () => {
    const root = tempRoot({ "foliplus/js/ui/form.ts": 'el.style.top = "1px";\n' });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([], root)).toBe(0);
      expect(main(["--check"], root)).toBe(1);
      expect(error).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("honours an explicit --root instead of the caller's root", () => {
    const root = tempRoot({ "foliplus/js/ui/form.ts": 'el.style.top = "1px";\n' });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check", "--root", root], "/definitely/not/here")).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("foliplus/js/ui/form.ts"),
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("falls back to the caller's root when --root has no value", () => {
    const root = tempRoot({ "foliplus/js/ui/form.ts": 'el.style.top = "1px";\n' });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check", "--root"], root)).toBe(1);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("exits 0 with --check on a clean tree", () => {
    const root = tempRoot({
      "foliplus/js/ui/form.ts": "const ok = 1;\n",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["--check"], root)).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  it("keeps the real repo baseline clean", () => {
    const result = scan(process.cwd());
    expect(result.findings).toEqual([]);
    expect(result.exemptions.length).toBeGreaterThan(0);
  });
});
