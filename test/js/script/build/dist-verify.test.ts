// test/js/script/build/dist-verify — --verify fails on a missing or stale dist, with a rebuild hint
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDist } from "#script/build/dist-verify.mjs";
import { computeSourceHash } from "#script/build/source-hash.mjs";

const roots: string[] = [];

/** A temp root with one JS+CSS source and (optionally) a dist tree. */
const fixture = (options: {
  artifacts?: string[];
  sourceHash?: string | null;
  buildVersion?: string | null;
  extraSources?: Record<string, string>;
  omitCss?: boolean;
  manifestText?: string;
}): string => {
  const root = mkdtempSync(join(tmpdir(), "dist-verify-"));
  roots.push(root);
  const sources: Record<string, string> = {
    "foliplus/js/a.ts": "export const a = 1;\n",
    "foliplus/css/a.css": ".a { color: red; }\n",
    ...(options.extraSources ?? {}),
  };
  for (const [rel, content] of Object.entries(sources)) {
    const abs = resolve(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const dist = resolve(root, "foliplus/dist");
  mkdirSync(dist, { recursive: true });
  if (options.manifestText !== undefined) {
    writeFileSync(resolve(dist, "manifest.json"), options.manifestText);
  } else if (options.artifacts) {
    for (const name of options.artifacts) {
      writeFileSync(resolve(dist, `foliplus-${name}.min.js`), "// js\n");
      if (!options.omitCss) {
        writeFileSync(resolve(dist, `foliplus-${name}.min.css`), "/* css */\n");
      }
    }
    const manifest: Record<string, unknown> = { artifacts: options.artifacts };
    if (options.sourceHash !== null) {
      manifest.sourceHash = options.sourceHash ?? computeSourceHash(root);
    }
    if (options.buildVersion !== null) {
      manifest.buildVersion = options.buildVersion ?? "v1";
    }
    writeFileSync(
      resolve(dist, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("verifyDist", () => {
  it("accepts a complete dist built from the current sources", () => {
    const root = fixture({ artifacts: ["common"], buildVersion: "v1" });
    expect(verifyDist({ root, buildVersion: "v1" })).toEqual([]);
  });

  it("reports a stale dist after a source edit, naming the rebuild", () => {
    const root = fixture({ artifacts: ["common"], buildVersion: "v1" });
    writeFileSync(resolve(root, "foliplus/js/a.ts"), "export const a = 2;\n");
    const problems = verifyDist({ root, buildVersion: "v1" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("stale dist:");
    expect(problems[0]).toContain("npm run build");
  });

  it("reports missing artifacts from the manifest", () => {
    const root = fixture({ artifacts: ["common"], omitCss: true });
    const problems = verifyDist({ root });
    expect(problems.join("\n")).toContain("Missing artifacts: foliplus-common.min.css");
  });

  it("reports a manifest that was never written", () => {
    const root = fixture({});
    expect(verifyDist({ root })).toEqual([
      "No dist/manifest.json — run `npm run build` first",
    ]);
  });

  it("reports a manifest without a source hash as built by an older script", () => {
    const root = fixture({ artifacts: ["common"], sourceHash: null });
    expect(verifyDist({ root }).join("\n")).toContain("no sourceHash");
  });

  it("reports a build version that differs from this checkout", () => {
    const root = fixture({ artifacts: ["common"], buildVersion: "v0-old" });
    expect(verifyDist({ root, buildVersion: "v1" }).join("\n")).toContain(
      "built as v0-old",
    );
  });

  it("reports malformed JSON and a missing artifacts array", () => {
    const brokenJson = fixture({ manifestText: "{not json" });
    expect(verifyDist({ root: brokenJson }).join("\n")).toContain("not valid JSON");
    const noArray = fixture({ manifestText: "{}\n" });
    expect(verifyDist({ root: noArray }).join("\n")).toContain("no artifacts array");
  });
});
