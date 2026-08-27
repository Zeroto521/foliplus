import {
  collectExports,
  collectSources,
  scanSharedImports,
  sharedGlobalNamespace,
} from "#script/global-namespace-plugin.mjs";
import { describe, expect, it } from "vitest";

describe("sharedGlobalNamespace", () => {
  it("maps BaseControl to foliplus.BaseControl", () => {
    expect(sharedGlobalNamespace("#foliplus/BaseControl.js")).toBe(
      "foliplus.BaseControl",
    );
  });

  it("maps hint.js to foliplus.hint", () => {
    expect(sharedGlobalNamespace("#core/hint.js")).toBe("foliplus.hint");
  });

  it("maps component.js to foliplus.core.component", () => {
    expect(sharedGlobalNamespace("#core/component.js")).toBe("foliplus.core.component");
  });

  it("maps mode.js to foliplus.core.mode", () => {
    expect(sharedGlobalNamespace("#core/mode.js")).toBe("foliplus.core.mode");
  });

  it("maps core subdirectory to foliplus.core.sub", () => {
    expect(sharedGlobalNamespace("#core/layer/index.js")).toBe("foliplus.core.layer");
    expect(sharedGlobalNamespace("#core/event/index.js")).toBe("foliplus.core.event");
  });

  it("maps common modules to foliplus.common.mod", () => {
    expect(sharedGlobalNamespace("#common/dom.js")).toBe("foliplus.common.dom");
    expect(sharedGlobalNamespace("#common/storage.js")).toBe("foliplus.common.storage");
    expect(sharedGlobalNamespace("#common/coord.js")).toBe("foliplus.common.coord");
  });
});

describe("collectExports", () => {
  it("collects const/let/var/function/class declarations", () => {
    const code = `
      export const FOO = 1;
      export let BAR = 2;
      export var BAZ = 3;
      export function QUX() {}
      export class WIDGET {}
      export async function ASYNC() {}
    `.trim();

    const tmpDir = createTempFile("collect.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("FOO");
      expect(exports).toContain("BAR");
      expect(exports).toContain("BAZ");
      expect(exports).toContain("QUX");
      expect(exports).toContain("WIDGET");
      expect(exports).toContain("ASYNC");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects named exports", () => {
    const code = `
      const A = 1;
      const B = 2;
      export { A, B };
    `.trim();

    const tmpDir = createTempFile("named.test.ts", code);
    try {
      expect(collectExports(tmpDir.path)).toContain("A");
      expect(collectExports(tmpDir.path)).toContain("B");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects re-exported names", () => {
    const code = `
      export { X, Y } from "./other.js";
    `.trim();

    const tmpDir = createTempFile("reexport.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("X");
      expect(exports).toContain("Y");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects export * from barrel", () => {
    const barrel = `
      export { A } from "./a.js";
      export { B } from "./b.js";
    `.trim();

    const aModule = createTempFile("a.test.ts", "export const A = 1;");
    const bModule = createTempFile("b.test.ts", "export const B = 2;");

    const barrelFile = createTempFile("barrel.test.ts", barrel);
    try {
      const exports = collectExports(barrelFile.path);
      expect(exports).toContain("A");
      expect(exports).toContain("B");
    } finally {
      aModule.cleanup();
      bModule.cleanup();
      barrelFile.cleanup();
    }
  });

  it("excludes type-only exports", () => {
    const code = `
      export type TypeName = string;
      export const value = 1;
    `.trim();

    const tmpDir = createTempFile("types.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).not.toContain("TypeName");
      expect(exports).toContain("value");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("resolves .js to .ts", () => {
    const code = "export const FOO = 1;";
    const tmpDir = createTempFile("resolve.test.ts", code);
    try {
      // Ask for .js, should find .ts
      const exports = collectExports(tmpDir.path.replace(/.ts$/, ".js"));
      expect(exports).toContain("FOO");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("returns empty for nonexistent file", () => {
    expect(collectExports("/nonexistent/file.js")).toEqual([]);
  });
});

describe("collectExports with as alias", () => {
  it("returns the alias name for export { X as Y }", () => {
    // Both the declaration name AND the alias are valid exports
    const code = "export const INNER = 1;\nexport { INNER as OUTER };";
    const tmpDir = createTempFile("alias.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("OUTER");
      expect(exports).toContain("INNER");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("uses alias name when re-exporting from another module", () => {
    const code =
      'export { DEFAULT_TIMEOUT_MS as GEODECODE_TIMEOUT_MS } from "./other.js";';
    const tmpDir = createTempFile("alias2.test.ts", code);
    const fs = require("fs");
    const path = require("path");
    const otherPath = path.join(path.dirname(tmpDir.path), "other.js");
    try {
      fs.writeFileSync(otherPath, "export const DEFAULT_TIMEOUT_MS = 5000;", "utf-8");
      const exports = collectExports(tmpDir.path);
      // The alias name is present (from the re-export line)
      expect(exports).toContain("GEODECODE_TIMEOUT_MS");
      // The local name is also present (recursive resolution of the target)
      expect(exports).toContain("DEFAULT_TIMEOUT_MS");
    } finally {
      tmpDir.cleanup();
      try {
        fs.unlinkSync(otherPath);
      } catch {}
    }
  });
});

describe("collectSources", () => {
  it("collects .ts sources from a directory recursively", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-cs-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(path.join(base, "sub"), { recursive: true });
    fs.writeFileSync(path.join(base, "a.ts"), "export const A = 1;", "utf-8");
    fs.writeFileSync(path.join(base, "sub", "b.ts"), "export const B = 2;", "utf-8");
    fs.writeFileSync(path.join(base, "c.d.ts"), "export type C = string;", "utf-8");
    try {
      const sources = collectSources(base);
      expect(sources).toHaveLength(2);
      expect(sources[0]).toContain("A");
      expect(sources[1]).toContain("B");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("scanSharedImports", () => {
  it("collects named imports from #core/#common/#foliplus", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      [
        'import { ensureHint, HINT_DURATION } from "#core/hint.js";',
        'import { BaseControl } from "#foliplus/BaseControl.js";',
        'import { dom, createIconButton } from "#common/dom.js";',
        'import { createTranslator } from "#common/locale.js";',
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(base, "helper.ts"),
      'import { fromWgs84 } from "#common/coord.js";',
      "utf-8",
    );
    try {
      const { used, starUsed } = scanSharedImports(base);
      expect(used.has("#core/hint.js")).toBe(true);
      expect(used.get("#core/hint.js")).toEqual(
        new Set(["ensureHint", "HINT_DURATION"]),
      );
      expect(used.has("#foliplus/BaseControl.js")).toBe(true);
      expect(used.get("#foliplus/BaseControl.js")).toEqual(new Set(["BaseControl"]));
      expect(used.has("#common/dom.js")).toBe(true);
      expect(used.get("#common/dom.js")).toEqual(new Set(["dom", "createIconButton"]));
      expect(used.has("#common/coord.js")).toBe(true);
      expect(used.get("#common/coord.js")).toEqual(new Set(["fromWgs84"]));
      expect(used.has("#common/locale.js")).toBe(true);
      expect(used.get("#common/locale.js")).toEqual(new Set(["createTranslator"]));
      expect(starUsed.size).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("tracks star import property usage", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si2-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      [
        'import * as Icons from "#common/icon.js";',
        "console.log(Icons.LOADING);",
        "console.log(Icons.CLOSE);",
      ].join("\n"),
      "utf-8",
    );
    try {
      const { used, starUsed } = scanSharedImports(base);
      expect(used.size).toBe(0);
      expect(starUsed.has("#common/icon.js")).toBe(true);
      expect(starUsed.get("#common/icon.js")).toEqual(new Set(["LOADING", "CLOSE"]));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("handles import { X as Y } notation", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si3-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      'import { ensureHint as H } from "#core/hint.js";',
      "utf-8",
    );
    try {
      const { used } = scanSharedImports(base);
      expect(used.has("#core/hint.js")).toBe(true);
      expect(used.get("#core/hint.js")).toEqual(new Set(["ensureHint"]));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

// Helper: create a temp .ts file and return { path, cleanup }
const tmpDir = require("os").tmpdir();
let tmpCount = 0;

function createTempFile(name, content) {
  const fs = require("fs");
  const path = require("path");
  const filePath = path.join(tmpDir, "dsh-test-" + tmpCount++ + "-" + name);
  fs.writeFileSync(filePath, content, "utf-8");
  return {
    path: filePath,
    cleanup: () => {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    },
  };
}
