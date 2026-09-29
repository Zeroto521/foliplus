/**
 * Structural guards for the bundle workflow's two tracks.
 *
 * The split is easy to regress: a step that reads `base-sizes.json` / `--baseline`
 * accidentally left on the main-push track exits non-zero (no base captured) and
 * would make the baseline upload job red for reasons that have nothing to do
 * with the upload. These asserts lock the partition.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(resolve(".github/workflows/bundle.yaml"), "utf8");

/** Body of `jobs.<name>` up to the next job key at the same indent. */
const jobBody = (name: string): string => {
  const start = raw.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  if (start < 0) throw new Error(`job ${name} not found`);
  const rest = raw.slice(start);
  const next = rest.search(/\n  [a-zA-Z_][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
};

describe("bundle.yaml track partition", () => {
  it("exposes the PR, main-push, and manual triggers", () => {
    expect(raw).toMatch(/^ {2}pull_request:\s*$/m);
    expect(raw).toMatch(/^ {2}push:\s*$/m);
    expect(raw).toMatch(/^ {4}branches: \[main\]/m);
    expect(raw).toMatch(/^ {2}workflow_dispatch:\s*$/m);
  });

  it("gates `report` to pull_request only", () => {
    expect(jobBody("report")).toMatch(
      /if: \$\{\{ github\.event_name == 'pull_request' \}\}/,
    );
  });

  it("gates `upload` to push / workflow_dispatch, never pull_request", () => {
    const cond = jobBody("upload");
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("github.event_name == 'workflow_dispatch'");
    expect(cond).not.toContain("== 'pull_request'");
  });

  it("keeps every baseline reader on the report track", () => {
    const report = jobBody("report");
    expect(report).toContain("--emit=base-sizes.json");
    expect(report).toContain("--baseline=base-sizes.json");
    expect(report).toContain("--enforce");
  });

  it("keeps the upload track free of baseline / PR-context steps", () => {
    const upload = jobBody("upload");
    for (const forbidden of [
      "base-sizes.json",
      "--baseline",
      "--enforce",
      "github.base_ref",
      "github.head_ref",
      "sticky-pull-request-comment",
      "bundle-size-check",
    ]) {
      expect(upload).not.toContain(forbidden);
    }
  });

  it("runs fuse and the Codecov upload on the upload track", () => {
    const upload = jobBody("upload");
    expect(upload).toContain("bundle-fuse.mjs");
    expect(upload).toContain("codecov-bundle-upload.mjs");
    // Hard-fail on purpose: this job's sole purpose is landing the baseline.
    expect(upload).not.toMatch(/continue-on-error:\s*true/);
  });
});
