import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#ui/styleModeKey.js";

// Style-mode single-source guard. See ui/styleModeKey.ts.
//
// (1) CJK white-list: the style-mode key file and its own test must stay
//     ASCII-only — the zh/en text lives only in foliplus/locale. Other
//     foliplus/js sources MAY keep existing CJK comments; the user's rule is
//     that new CJK-dominant comments are not allowed, but existing reasonable
//     Chinese comments are not force-cleaned. This once swept the whole tree
//     (which translated 21 CJK chars and the user reverted 2 files), so the
//     guard now targets only the i18n-owned files.
// (2) Every t()/ui.T() locale key referenced from foliplus/js must exist in
//     BOTH the zh and en JSON tables (forward alignment).
// (3) Reverse alignment: every style_* locale key in the LayerControl JSON
//     must be referenced from foliplus/js — an orphan key (e.g. a deleted
//     feature's leftover vocabulary) fails. A key held "for later" must be
//     registered in the explicit allow-list below with its reason.
// (4) STYLE_MODE keys are defined and non-empty in both zh and en.

const JS_ROOT = join(process.cwd(), "foliplus/js");
const LOCALE_EN = JSON.parse(
  readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.en.json"), "utf8"),
);
const LOCALE_ZH = JSON.parse(
  readFileSync(join(process.cwd(), "foliplus/locale/LayerControl.zh.json"), "utf8"),
);

// Escaped CJK range so this file itself stays ASCII-only.
const CJK = /[\u4e00-\u9fff]/;

// The files that are themselves user-visible i18n/word-list sources: these
// must be ASCII-only. Every other foliplus/js file may keep existing CJK
// comments (see the user rule recorded above).
const ASCII_ONLY_SOURCES = ["ui/styleModeKey.ts"];

// A locale key that exists in the JSON but is not yet referenced from JS
// would be an orphan. The only keys allowed to be "prepared for later" are
// registered here with their reason; anything else fails.
const ORPHAN_ALLOW_LIST: Record<string, string> = {
  // style_fill_original_levels is referenced through a .replace() call in
  // fill.ts (the {n} substitution), not a bare T("...") literal, so the
  // reference scanner below cannot see it; it is genuinely used.
  style_fill_original_levels: "referenced via .replace() in fill.ts (originalCaption)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const tsFiles = walk(JS_ROOT);

/** All style_* locale keys present in the en JSON. */
const localeStyleKeys = Object.keys(LOCALE_EN)
  .filter(k => k.startsWith("LayerControl.style_"))
  .map(k => k.slice("LayerControl.".length));

/** Collect every style_* key the JS sources reference, both as a literal
 *  T("style_*") and as a STYLE_MODE constant value. */
function referencedStyleKeys(): Set<string> {
  const refs = new Set<string>();
  for (const p of tsFiles) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(/(?:ui\.T|\bt)\(\s*"([^"]+)"\s*\)/g)) {
      const k = m[1] as string;
      if (k.startsWith("style_")) refs.add(k);
    }
    for (const m of s.matchAll(/STYLE_MODE\.([A-Z_]+)/g)) {
      const key = (STYLE_MODE as Record<string, string>)[m[1] as string];
      if (key) refs.add(key);
    }
  }
  return refs;
}

describe("style mode single source", () => {
  it("keeps the i18n-owned source files ASCII-only (white-list CJK)", () => {
    const hits: string[] = [];
    for (const rel of ASCII_ONLY_SOURCES) {
      const p = join(JS_ROOT, rel);
      const s = readFileSync(p, "utf8");
      const count = (s.match(CJK) ?? []).length;
      if (count > 0) hits.push(`${rel}: ${count} CJK char(s)`);
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
        if (!(fk in LOCALE_EN)) {
          missing.push(`${relative(JS_ROOT, p)}:${line}: ${key} (missing en)`);
        }
        if (!(fk in LOCALE_ZH)) {
          missing.push(`${relative(JS_ROOT, p)}:${line}: ${key} (missing zh)`);
        }
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

  it("forbids orphan style_* locale keys (reverse alignment)", () => {
    const refs = referencedStyleKeys();
    const orphans = localeStyleKeys.filter(
      k => !refs.has(k) && !(k in ORPHAN_ALLOW_LIST),
    );
    expect(orphans).toEqual([]);
  });

  it("keeps the en and zh style_* key sets identical", () => {
    const zhStyleKeys = Object.keys(LOCALE_ZH)
      .filter(k => k.startsWith("LayerControl.style_"))
      .map(k => k.slice("LayerControl.".length))
      .sort();
    expect(zhStyleKeys).toEqual([...localeStyleKeys].sort());
  });
});
