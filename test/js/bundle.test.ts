/**
 * Structural guards for the bundle workflow's single job / two tracks.
 *
 * The split is easy to regress: a step that reads `base-sizes.json` / `--baseline`
 * accidentally left ungated runs on a main push, exits non-zero (no base
 * captured), and makes the baseline upload red for reasons that have nothing
 * to do with the upload. These asserts lock the partition.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(resolve(".github/workflows/bundle.yaml"), "utf8");
const jobSection = raw.slice(raw.search(/^jobs:/m));
const PR_GATE = "if: ${{ github.event.pull_request }}";

/** Offsets of each step head (`- name:` / `- uses:` / `- run:`) in the job. */
const stepStarts = [...jobSection.matchAll(/^ {6}- (?:name|uses|run):/gm)].map(
  m => m.index,
);

const stepAt = (i: number) =>
  jobSection.slice(stepStarts[i], stepStarts[i + 1] ?? jobSection.length);

/** First step whose body includes the exact substring. */
const stepContaining = (needle: string) =>
  stepStarts.map((_, i) => stepAt(i)).find(s => s.includes(needle));

describe("bundle.yaml single job / two tracks", () => {
  it("exposes the PR, main-push, and manual triggers", () => {
    expect(raw).toMatch(/^ {2}pull_request:\s*$/m);
    expect(raw).toMatch(/^ {2}push:\s*$/m);
    expect(raw).toMatch(/^ {4}branches: \[main\]/m);
    expect(raw).toMatch(/^ {2}workflow_dispatch:\s*$/m);
  });

  it("defines exactly one job", () => {
    const jobKeys = [...jobSection.matchAll(/^ {2}([a-zA-Z_]\w*):\s*$/gm)].map(
      m => m[1],
    );
    expect(jobKeys).toEqual(["bundle"]);
  });

  it("gates every baseline reader on pull_request", () => {
    const baselineSteps = stepStarts
      .map((_, i) => stepAt(i))
      .filter(s => s.includes("bundle-size-check"));
    expect(baselineSteps.length).toBeGreaterThanOrEqual(3); // capture/report/enforce
    for (const s of baselineSteps) {
      expect(s).toContain(PR_GATE);
    }
  });

  it("gates the treemap artifact, sticky comment, and treemap link on PR", () => {
    expect(stepContaining("upload-artifact")).toContain(PR_GATE);
    expect(stepContaining("sticky-pull-request-comment")).toContain(PR_GATE);
    expect(stepContaining("Link treemap report")).toContain(PR_GATE);
  });

  it("runs the Codecov upload on both tracks (no event gate)", () => {
    const upload = stepContaining("codecov-bundle-upload.mjs");
    expect(upload).toBeDefined();
    expect(upload).not.toMatch(/^ {8}if:/m);
    // Fail-open on PR (an outage must not block the sticky table or merge),
    // hard-fail on a main push (the whole point is landing the baseline).
    expect(upload).toContain(
      "continue-on-error: ${{ github.event_name == 'pull_request' }}",
    );
  });

  it("runs fuse on both tracks (no event gate)", () => {
    const fuse = stepContaining("bundle-fuse.mjs");
    expect(fuse).not.toContain(PR_GATE);
  });
});
