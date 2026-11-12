import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
  findControlInsetViolations,
  main,
  runCli,
} from "#script/check/control-inset.mjs";

// Control inset single-source guard: .foliplus-input-skin owns the one
// horizontal text inset of the input family (--foliplus-ctrl-inset-x), and
// .foliplus-form-select declares no left padding so the left inset falls
// through to the skin. A second consumer, or a per-control literal left
// padding, re-misaligns the readonly/select/trigger text column when the token
// is edited. The compact number field is exempt (centered, not an alignment
// point).

const REPO_ROOT = process.cwd();
const FORM_CSS = "foliplus/css/common/form.css";

/** A synthetic repo: form.css at the real relative path. */
const makeRepo = (cssBody: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "control-inset-"));
  mkdirSync(join(dir, "foliplus", "css", "common"), { recursive: true });
  writeFileSync(join(dir, FORM_CSS), cssBody);
  return dir;
};

const GOOD = `.foliplus-input-skin {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
.foliplus-form-select {
  padding-right: var(--foliplus-space-xxl);
}
`;

describe("control inset single source", () => {
  it("the real form.css has exactly one token consumer, on the skin", () => {
    const hits = findControlInsetViolations(REPO_ROOT);
    expect(hits).toEqual([]);
  });

  it("flags a second token consumer (select literal left padding)", () => {
    const dir = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
.foliplus-form-select {
  padding-right: var(--foliplus-space-xxl);
  padding-left: var(--foliplus-space-md);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toMatch(/left inset/);
  });

  it("flags the skin losing the token (no consumer)", () => {
    const dir = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-space-md);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toMatch(/no consumer/);
  });

  it("flags a 4-value form-select shorthand with a literal left", () => {
    const dir = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
.foliplus-form-select {
  padding: 0 var(--foliplus-space-xxl) 0 var(--foliplus-space-md);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toMatch(/left inset/);
  });

  it("passes a clean skin + padding-right-only select", () => {
    const dir = makeRepo(GOOD);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("reports a missing form.css", () => {
    const dir = makeRepo("");
    rmSync(join(dir, FORM_CSS));
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toMatch(/not found/);
  });

  it("main() returns 0 on a clean repo and 1 on a violation", () => {
    const dir = makeRepo(GOOD);
    expect(main(dir)).toBe(0);
    rmSync(dir, { recursive: true, force: true });

    const bad = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-space-md);
}
`);
    expect(main(bad)).toBe(1);
    rmSync(bad, { recursive: true, force: true });
  });

  it("runCli dispatch runs main when the entry matches the module (in-process)", () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    const dir = makeRepo(GOOD);
    runCli([dir], __entryUrl);
    expect(process.exitCode).toBe(0);
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCli dispatch is a no-op when the entry is not this module", () => {
    const prev = process.exitCode;
    process.exitCode = 42;
    runCli([resolve(".")], "C:/not/this/module.js");
    expect(process.exitCode).toBe(42);
    process.exitCode = prev;
  });

  it("flags a second token consumer (token appears twice)", () => {
    const dir = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
.foliplus-form-select {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(2);
    expect(hits[0].text).toMatch(/expected exactly one consumer/);
  });

  it("flags the single token consumer being on a non-skin rule", () => {
    const dir = makeRepo(`.foliplus-form-select {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toMatch(/other than .foliplus-input-skin/);
  });

  it("runCli drives the violating main path (prints the violation)", () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    const dir = makeRepo(`.foliplus-input-skin {
  padding: 0 var(--foliplus-ctrl-inset-x);
}
.foliplus-form-select {
  padding-right: var(--foliplus-space-xxl);
  padding-left: var(--foliplus-space-md);
}
`);
    runCli([dir], __entryUrl);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores CSS comments when scanning rules", () => {
    const dir = makeRepo(`/* header comment */
.foliplus-input-skin {
  /* inline comment */
  padding: 0 var(--foliplus-ctrl-inset-x);
}
/* multi
   line comment */
.foliplus-form-select {
  padding-right: var(--foliplus-space-xxl);
}
`);
    const hits = findControlInsetViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });
});
