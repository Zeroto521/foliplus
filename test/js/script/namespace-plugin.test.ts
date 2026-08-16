import { describe, expect, it } from "vitest";
import {
  collectExports,
  sharedGlobalNamespace,
} from "../../../script/global-namespace-plugin.mjs";

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

    const aFile = createTempFile("a.test.ts", "export const A = 1;");
    const bFile = createTempFile("b.test.ts", "export const B = 2;");

    const barrelFile = createTempFile("barrel.test.ts", barrel);
    try {
      const exports = collectExports(barrelFile.path);
      expect(exports).toContain("A");
      expect(exports).toContain("B");
    } finally {
      aFile.cleanup();
      bFile.cleanup();
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
