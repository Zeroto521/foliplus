import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectExports,
  sharedGlobalNamespace,
} from "#script/global-namespace-plugin.mjs";

describe("sharedGlobalNamespace", () => {
  it("maps #core/layer/* to foliplus.core.layer", () => {
    expect(sharedGlobalNamespace("#core/layer/index.js")).toBe("foliplus.core.layer");
    expect(sharedGlobalNamespace("#core/layer/LayerFactory.js")).toBe(
      "foliplus.core.layer",
    );
  });

  it("maps #core/hint.js to foliplus.hint", () => {
    expect(sharedGlobalNamespace("#core/hint.js")).toBe("foliplus.hint");
  });

  it("maps #foliplus/BaseControl.js to foliplus.BaseControl", () => {
    expect(sharedGlobalNamespace("#foliplus/BaseControl.js")).toBe(
      "foliplus.BaseControl",
    );
  });

  it("maps #common/<mod>.js to foliplus.common.<mod>", () => {
    expect(sharedGlobalNamespace("#common/dom.js")).toBe("foliplus.common.dom");
    expect(sharedGlobalNamespace("#common/coord.js")).toBe("foliplus.common.coord");
  });
});

describe("collectExports", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliplus-exports-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("collects named declarations", () => {
    const f = join(dir, "a.ts");
    writeFileSync(
      f,
      "export const foo = 1;\nexport function bar() {}\nexport class Baz {}\n",
    );
    expect(collectExports(f)).toEqual(["foo", "bar", "Baz"]);
  });

  it("follows export * from barrels", () => {
    const sub = join(dir, "sub.ts");
    writeFileSync(sub, "export const x = 1;\n");
    const barrel = join(dir, "index.ts");
    writeFileSync(barrel, 'export * from "./sub.js";\n');
    expect(collectExports(barrel)).toEqual(["x"]);
  });

  it("follows export { x } from re-exports", () => {
    const sub = join(dir, "src.ts");
    writeFileSync(sub, "export const y = 1;\n");
    const re = join(dir, "re.ts");
    writeFileSync(re, 'export { y } from "./src.js";\n');
    expect(collectExports(re)).toEqual(["y"]);
  });

  it("handles type exports without leaking them", () => {
    const f = join(dir, "types.ts");
    writeFileSync(
      f,
      "export type Foo = string;\nexport interface Bar {}\nexport const value = 1;\n",
    );
    const names = collectExports(f);
    expect(names).toContain("value");
    expect(names).not.toContain("Foo");
    expect(names).not.toContain("Bar");
  });
});
