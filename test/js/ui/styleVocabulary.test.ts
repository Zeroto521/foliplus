import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#ui/styleVocabulary.js";

// Style-vocabulary single-source guard. See ui/styleVocabulary.ts.
// (1) No CJK characters in foliplus/js .ts sources — locale JSON is the only place
//     allowed to carry the zh/en text;
// (2) every referenced t()/ui.T() locale key exists in both the zh and en JSON tables;
// (3) STYLE_MODE keys are defined and non-empty in both zh and en.

const JS_ROOT = join(process.cwd(), "foliplus/js");
const LOCALE_EN = JSON.parse(readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.en.json"), "utf8"));
const LOCALE_ZH = JSON.parse(readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.zh.json"), "utf8"));

// Escaped CJK range so this file itself stays ASCII-only.
const CJK = /[\u4e00-\u9fff]/;

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
  it("forbids CJK characters in foliplus/js sources", () => {
    const hits: string[] = [];
    for (const p of tsFiles) {
      const s = readFileSync(p, "utf8");
      const count = (s.match(CJK) ?? []).length;
      if (count > 0) hits.push(`${relative(JS_ROOT, p)}: ${count} CJK char(s)`);
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
