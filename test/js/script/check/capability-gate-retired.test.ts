// Guard: the `capabilityGate` factory was retired when the per-dimension
// gates were folded into the styleCapability projection (task-128 S2). A
// leftover import/use would mean a production file still reads the old
// two-layer gate instead of the single projection, so the menu and the
// panel could disagree about which dimensions a layer supports.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

/** Walk every production .ts under foliplus/js and collect any file that
 *  still names `capabilityGate`. */
const findCapabilityGate = (root: string): string[] => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(full, "utf8");
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            continue;
          }
          if (trimmed.includes("capabilityGate")) {
            hits.push(full);
            break;
          }
        }
      }
    }
  };
  walk(join(root, "foliplus", "js"));
  return hits;
};

describe("capabilityGate is retired from the production surface", () => {
  it("finds no capabilityGate reference in foliplus/js", { timeout: 60000 }, () => {
    expect(findCapabilityGate(REPO_ROOT)).toEqual([]);
  });
});
