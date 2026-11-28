// test/js/guard/config-narrowing — every control narrows its CONFIG to its own schema.
//
// foliplus/js/config-schema.ts generates one strict Config<Name> interface per
// control, but the flat ComponentConfig carries a [key: string]: unknown escape
// hatch, so a misspelt CONFIG key type-checks and is undefined at runtime.
// Each control entry narrows the IIFE global once (CONFIG as Config<Name>) and
// hands the typed config down; this guard pins that a control directory
// references its own Config<Name>. The allowlist is a burn-down list: a control
// still on the flat type names the task that narrows it, and once it is
// narrowed the entry must be deleted (a stale entry fails the guard).
//
// Tree guard, not a script module: registered under GUARD_TREE_SUBJECTS.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const CONTROL_ROOT = resolve(REPO_ROOT, "foliplus/js/control");

/** Controls whose entry still uses the flat ComponentConfig, and the task that
 *  removes the entry. LayerControl is last: #1402 rewrites its placement code
 *  first, so narrowing it here would collide with that branch. */
const NOT_YET_NARROWED: Record<string, string> = {
  ExportControl: "task-203 batch 2",
  FullscreenControl: "task-203 batch 2",
  LayerControl: "#1402 rewrites its placement code first",
  LocateControl: "task-203 batch 2",
  ScaleControl: "task-203 batch 2",
};

const controlDirs = (): string[] =>
  readdirSync(CONTROL_ROOT)
    .filter(name => statSync(join(CONTROL_ROOT, name)).isDirectory())
    .sort();

const sources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(join(CONTROL_ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
};

const configType = (dir: string): string => `Config${dir.replace(/Control$/, "")}`;

const references = (dir: string, type: string): boolean =>
  sources(dir).some(rel =>
    readFileSync(join(CONTROL_ROOT, rel), "utf8").includes(type),
  );

describe("every control narrows CONFIG to its own Config<Name>", () => {
  it("names only controls that exist", () => {
    const dirs = controlDirs();
    const unknown = Object.keys(NOT_YET_NARROWED).filter(dir => !dirs.includes(dir));
    expect(
      unknown,
      `NOT_YET_NARROWED names a control directory that does not exist: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("has no control reading the flat escape-hatch type", () => {
    const flat = controlDirs()
      .filter(dir => !(dir in NOT_YET_NARROWED))
      .filter(dir => !references(dir, configType(dir)))
      .map(dir => `${dir} should reference ${configType(dir)}`);
    expect(
      flat,
      `narrow the entry (CONFIG as Config<Name>) so a misspelt read fails typecheck: ${flat.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the burn-down list honest", () => {
    const stale = Object.keys(NOT_YET_NARROWED)
      .filter(dir => references(dir, configType(dir)))
      .map(
        dir =>
          `${dir} already references ${configType(dir)} (recorded as ${NOT_YET_NARROWED[dir]}): delete its NOT_YET_NARROWED entry`,
      );
    expect(stale, stale.join("; ")).toEqual([]);
  });
});
