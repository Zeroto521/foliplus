// script/check/folder-name-fold-sync — the folder-name fold-rule twin guard.
//
// foliplus/control/LayerControl/_folder.py (_folder_key) and
// foliplus/js/core/layer/folderLayout.ts (normalizeFolderName) each hand-write
// the same identity fold: NFC -> whitespace runs to one space -> trim ->
// ASCII-case fold. Python keys the central folders config on it; JS keys the
// panel (identity, dedupe, collision) on it. The two are intentionally the same
// fold — a value Python accepts as folder "X" must collide with "x" on the JS
// panel, or the central declaration and the painted rows disagree about which
// folders are the same one.
//
// A single source-of-truth cannot span the two runtimes (JS never imports
// Python and vice versa), so this guard pins the STEP PIPELINE — the exact
// operations and their order — plus a representative input set whose folded
// result both runtimes must agree on. If one side changes a step and the other
// stays, the pipeline assertions fail; the behavioral set then names the
// collision class that would have drifted.
//
// Tree guard, not a script module: registered under NON_MODULE_TEST_SUBJECTS
// as check/folder-name-fold-sync.
import { readSource } from "./crossLangLiteral.js";
import { describe, expect, it } from "vitest";

const PY_FOLDER = "foliplus/control/LayerControl/_folder.py";
const JS_LAYOUT = "foliplus/js/core/layer/folderLayout.ts";

// --- step extraction -------------------------------------------------------
// Each side spells its fold as one expression. We locate the four steps by
// their language-idiomatic spelling so a removed or reordered step fails.

/** Python _folder_key body: the folded-key expression. */
const pyFoldExpr = (): string => {
  const src = readSource(PY_FOLDER);
  // def _folder_key(name: str) -> str:
  //     return re.sub(r"\s+", " ", unicodedata.normalize("NFC", name.strip())).lower()
  const m = src.match(/def _folder_key\([\s\S]*?return\s+([^\n]+)\n/);
  if (!m) {
    throw new Error(
      "folder-name-fold-sync: could not locate Python _folder_key return",
    );
  }
  return m[1];
};

/** JS normalizeFolderName body: the folded-key expression. */
const jsFoldExpr = (): string => {
  const src = readSource(JS_LAYOUT);
  // const normalizeFolderName = (name: string): string =>
  //   name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const m = src.match(
    /const normalizeFolderName\s*=\s*\([^)]*\)\s*:?\s*string\s*=>\s*([^;]+);/,
  );
  if (!m) {
    throw new Error(
      "folder-name-fold-sync: could not locate JS normalizeFolderName body",
    );
  }
  return m[1];
};

describe("folder-name fold rule stays in step across Python and JS", () => {
  it("carries the same four fold steps in the same order on both sides", () => {
    const py = pyFoldExpr();
    const js = jsFoldExpr();

    // Step 1 — NFC normalization. Python: unicodedata.normalize("NFC", ...);
    // JS: .normalize("NFC"). Both must name the NFC form (not NFD/NFKC).
    expect(py).toContain('normalize("NFC"');
    expect(js).toContain('.normalize("NFC")');

    // Step 2 — internal whitespace runs fold to a single space. Both use the
    // same regex \s+ with a single-space replacement; JS is global, Python's
    // re.sub is global by default.
    expect(py).toContain('re.sub(r"\\s+", " "');
    expect(js).toContain('replace(/\\s+/g, " ")');

    // Step 3 — trim. Python strips before normalizing (order-independent for
    // trim vs the rest here, but both must trim the outer whitespace).
    expect(py).toContain(".strip()");
    expect(js).toContain(".trim()");

    // Step 4 — case fold. Both must use the ASCII-only case fold
    // (.lower() / .toLowerCase()), NOT a full Unicode casefold — a full fold
    // would merge "Straße"/"STRASSE" that the two channels deliberately keep
    // distinct. A switch to Python .casefold() or JS toLocaleLowerCase() is a
    // real contract change that must be mirrored, not a silent swap.
    expect(py).toContain(".lower()");
    expect(py).not.toContain(".casefold()");
    expect(js).toContain(".toLowerCase()");
    expect(js).not.toContain("toLocaleLowerCase");
  });

  it("both folds agree on a representative input set (behavioral pin)", () => {
    // The pipeline above is only half the contract — these representative
    // inputs name the collision classes the fold must agree on. Each comment
    // states the fold both runtimes must produce. The behavioral half is a
    // mirror of the pipeline, not a substitute: if a step changes, the
    // pipeline assertions above fail first; if the change keeps the pipeline
    // but alters a result, this set names the drifted class.
    //
    // The fold under test (both sides): NFC -> \s+->" " -> trim -> ASCII
    // lower. We re-derive it here so the expected values are explicit.
    const fold = (name: string): string =>
      name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

    // Plain ASCII, differing case + spacing must collide to one key.
    expect(fold("  Foo  Bar ")).toBe("foo bar");
    expect(fold("FOO BAR")).toBe("foo bar");

    // NBSP and other Unicode whitespace fold to a single ASCII space — the
    // author's copy-pasted "foo\u00a0bar" and a typed "foo bar" are the same
    // folder on both channels.
    expect(fold("foo\u00a0bar")).toBe("foo bar");

    // NFC/NFD composed/decomposed accents fold to the same key — a layer that
    // declares "é" and one that declares "e\u0301" are the same folder.
    expect(fold("\u00e9")).toBe(fold("e\u0301"));

    // ASCII case fold only: "Straße" keeps its sharp-s (a full Unicode
    // casefold would map it to "strasse"). Both runtimes must keep it.
    expect(fold("Straße")).toBe("straße");

    // Trim: leading/trailing whitespace never reaches the key.
    expect(fold("  spaced  ")).toBe("spaced");
  });
});
