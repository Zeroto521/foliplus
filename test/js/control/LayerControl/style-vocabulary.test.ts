import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#ui/styleVocabulary.js";

// 样式词汇单源守卫：见 ui/styleVocabulary.ts。
// ① foliplus/js 不出现非受控中文着色文案字面量；
// ② 所有被引用的 t()/ui.T() locale key 在 zh/en 两份 JSON 中都存在（悬空 key 即红）；
// ③ STYLE_MODE 四个 key 在 zh/en 两份 JSON 中都定义且有值（缺翻译即红）。

const JS_ROOT = join(process.cwd(), "foliplus/js");
const LOCALE_EN = JSON.parse(
  readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.en.json"), "utf8"),
);
const LOCALE_ZH = JSON.parse(
  readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.zh.json"), "utf8"),
);

// 非受控中文着色文案：只在 locale JSON 里出现，js 源（含注释）一律禁止。
// 受控词（原色/单一颜色/按值着色/同填充）是 locale 值，不在 js 里出现。
const FORBIDDEN = ["按值描边", "跟随填充", "按值填充"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const tsFiles = walk(JS_ROOT);

describe("style vocabulary single source", () => {
  it("forbids non-canonical Chinese color-mode literals in js", () => {
    const hits: string[] = [];
    for (const p of tsFiles) {
      const s = readFileSync(p, "utf8");
      for (const w of FORBIDDEN) {
        if (s.includes(w)) hits.push(`${relative(JS_ROOT, p)}: ${w}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("defines every referenced locale key in zh and en", () => {
    const missing: string[] = [];
    for (const p of tsFiles) {
      const s = readFileSync(p, "utf8");
      for (const m of s.matchAll(/(?:ui\.T|\bt)\(\s*"([^"]+)"\s*\)/g)) {
        const key = m[1] as string;
        const fk = `LayerControl.${key}`;
        const line = s.slice(0, m.index ?? 0).split("\n").length;
        if (!(fk in LOCALE_EN)) missing.push(`${relative(JS_ROOT, p)}:${line}: ${key} (missing en)`);
        if (!(fk in LOCALE_ZH)) missing.push(`${relative(JS_ROOT, p)}:${line}: ${key} (missing zh)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps STYLE_MODE keys consistent and non-empty across locales", () => {
    for (const key of Object.values(STYLE_MODE)) {
      const fk = `LayerControl.${key as string}`;
      const en = LOCALE_EN[fk];
      const zh = LOCALE_ZH[fk];
      expect(en, `en missing ${key}`).toBeTruthy();
      expect(zh, `zh missing ${key}`).toBeTruthy();
    }
  });
});
