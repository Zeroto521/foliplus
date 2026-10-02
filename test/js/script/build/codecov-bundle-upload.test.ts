import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildServiceParams,
  encodeSlug,
  getPreSignedUrl,
  loadEvent,
  preProcessBody,
  runUpload,
  uploadStats,
} from "#script/build/codecov-bundle-upload.mjs";

let tmp = "";
afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  }
  vi.restoreAllMocks();
});

const writeMetafile = (root: string) => {
  mkdirSync(resolve(root, "foliplus/dist"), { recursive: true });
  writeFileSync(resolve(root, "foliplus/dist/foliplus-A.min.js"), "code");
  writeFileSync(
    resolve(root, "bundle-metafile.json"),
    JSON.stringify({
      inputs: { "src/a.ts": { bytes: 10, imports: [] } },
      outputs: {
        "foliplus/dist/foliplus-A.min.js": {
          bytes: 4,
          entryPoint: "src/a.ts",
          inputs: { "src/a.ts": { bytesInOutput: 4 } },
        },
      },
    }),
  );
};

// ── slug encoding (preProcessBody contract) ──────────────────────────
describe("encodeSlug", () => {
  it("encodes owner/repo to the Codecov upload form", () => {
    // owner "Zeroto521", repo "foliplus" → "Zeroto521::::foliplus"
    expect(encodeSlug("Zeroto521/foliplus")).toBe("Zeroto521::::foliplus");
  });

  it("joins multi-segment owners with :::", () => {
    // owner "a/b/" → "a:::b", then joined with repo via ::::
    expect(encodeSlug("a/b/repo")).toBe("a:::b::::repo");
  });

  it("throws when owner or repo is empty", () => {
    expect(() => encodeSlug("noslash")).toThrow(/Invalid owner/);
    expect(() => encodeSlug("owner/")).toThrow(/Invalid owner/);
    expect(() => encodeSlug("")).toThrow(/Invalid owner/);
  });
});

describe("preProcessBody", () => {
  it("encodes slug and nulls empty values", () => {
    const body = preProcessBody({
      slug: "Zeroto521/foliplus",
      branch: "",
      commit: "abc",
      pr: null,
    });
    expect(body.slug).toBe("Zeroto521::::foliplus");
    expect(body.branch).toBeNull();
    expect(body.commit).toBe("abc");
    expect(body.pr).toBeNull();
  });
});

// ── GHA service params ───────────────────────────────────────────────
describe("buildServiceParams", () => {
  it("maps GITHUB_* env for a branch push", () => {
    const params = buildServiceParams({
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/feat/x",
      GITHUB_REPOSITORY: "Zeroto521/foliplus",
      GITHUB_SHA: "deadbeef",
      GITHUB_RUN_ID: "123",
      GITHUB_WORKFLOW: "bundle",
    });
    expect(params).toMatchObject({
      branch: "feat/x",
      build: "123",
      commit: "deadbeef",
      job: "bundle",
      pr: null,
      service: "github-actions",
      slug: "Zeroto521/foliplus",
    });
    expect(params.buildURL).toBeNull();
    expect(params.compareSha).toBeNull();
  });

  it("prefers GITHUB_HEAD_REF and the event head sha on a PR", () => {
    const params = buildServiceParams(
      {
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/pull/42/merge",
        GITHUB_HEAD_REF: "feat/pr-branch",
        GITHUB_REPOSITORY: "Zeroto521/foliplus",
        GITHUB_SHA: "merge-commit-sha",
        GITHUB_RUN_ID: "9",
      },
      {
        pull_request: {
          number: 42,
          head: { sha: "head-sha" },
          base: { sha: "base-sha" },
        },
      } as never,
    );
    expect(params.branch).toBe("feat/pr-branch");
    expect(params.pr).toBe("42");
    expect(params.commit).toBe("head-sha");
    expect(params.compareSha).toBe("base-sha");
  });

  it("falls back to service=github outside GHA", () => {
    const params = buildServiceParams({});
    expect(params.service).toBe("github");
  });
});

describe("loadEvent", () => {
  it("returns null without GITHUB_EVENT_PATH", () => {
    expect(loadEvent({})).toBeNull();
  });

  it("reads the event JSON when the path exists", () => {
    tmp = mkdtempSync(join(tmpdir(), "foliplus-ev-"));
    const p = resolve(tmp, "event.json");
    writeFileSync(p, JSON.stringify({ pull_request: { number: 7 } }));
    expect(loadEvent({ GITHUB_EVENT_PATH: p })).toEqual({
      pull_request: { number: 7 },
    });
  });

  it("returns null on a missing or unreadable path", () => {
    expect(loadEvent({ GITHUB_EVENT_PATH: "/no/such/event.json" })).toBeNull();
  });
});

// ── HTTP protocol (presign + PUT) ────────────────────────────────────
const jsonRes = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe("getPreSignedUrl", () => {
  it("POSTs preProcessed service params and returns data.url", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { url: "https://signed" }));
    const url = await getPreSignedUrl({
      token: "tok",
      serviceParams: {
        branch: "b",
        build: null,
        buildURL: null,
        commit: "c",
        compareSha: null,
        job: null,
        pr: null,
        service: "github-actions",
        slug: "Zeroto521/foliplus",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(url).toBe("https://signed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [reqUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(reqUrl).toBe("https://api.codecov.io/upload/bundle_analysis/v1");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("token tok");
    const body = JSON.parse(String(init.body));
    expect(body.slug).toBe("Zeroto521::::foliplus");
    expect(body.branch).toBe("b");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(401, { detail: "nope" }));
    await expect(
      getPreSignedUrl({
        token: "bad",
        serviceParams: { commit: "c", slug: "a/b" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws when the response has no url", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, {}));
    await expect(
      getPreSignedUrl({
        token: "tok",
        serviceParams: { commit: "c" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/missing `url`/);
  });
});

describe("uploadStats", () => {
  it("PUTs the payload JSON to the presigned URL", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, {}));
    await uploadStats({
      preSignedUrl: "https://signed",
      message: '{"version":"3"}',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://signed");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"version":"3"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("throws on a non-ok PUT", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(500, {}));
    await expect(
      uploadStats({
        preSignedUrl: "https://signed",
        message: "{}",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/500/);
  });
});

// ── runUpload end-to-end (no network) ────────────────────────────────
describe("runUpload", () => {
  it("builds a payload and writes --out without touching the network", async () => {
    tmp = mkdtempSync(join(tmpdir(), "foliplus-cb-"));
    writeMetafile(tmp);
    const fetchImpl = vi.fn();
    const result = (await runUpload({
      root: tmp,
      metafile: "bundle-metafile.json",
      out: "payload.json",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
      event: null,
    })) as {
      uploaded: boolean;
      payload: { assets: unknown[] };
    };
    expect(result.uploaded).toBe(false);
    expect(result.payload.assets).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    const written = JSON.parse(readFileSync(resolve(tmp, "payload.json"), "utf-8")) as {
      bundleName: string;
      version: string;
    };
    expect(written.bundleName).toBe("foliplus");
    expect(written.version).toBe("3");
  });

  it("dryRun returns the payload without calling fetch", async () => {
    tmp = mkdtempSync(join(tmpdir(), "foliplus-cb-"));
    writeMetafile(tmp);
    const fetchImpl = vi.fn();
    const result = await runUpload({
      root: tmp,
      dryRun: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
      event: null,
    });
    expect(result.uploaded).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to upload without CODECOV_TOKEN", async () => {
    tmp = mkdtempSync(join(tmpdir(), "foliplus-cb-"));
    writeMetafile(tmp);
    await expect(
      runUpload({
        root: tmp,
        token: "",
        env: {},
        event: null,
      }),
    ).rejects.toThrow(/CODECOV_TOKEN/);
  });

  it("presigns and PUTs when a token is present", async () => {
    tmp = mkdtempSync(join(tmpdir(), "foliplus-cb-"));
    writeMetafile(tmp);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(200, { url: "https://signed" }))
      .mockResolvedValueOnce(jsonRes(200, {}));
    const result = (await runUpload({
      root: tmp,
      token: "tok",
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "Zeroto521/foliplus",
        GITHUB_SHA: "abc",
        GITHUB_REF: "refs/heads/main",
      },
      event: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })) as {
      uploaded: boolean;
      url?: string;
      payload: { assets: unknown[] };
    };
    expect(result.uploaded).toBe(true);
    expect(result.url).toBe("https://signed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ── Remaining branch arms (tokenless presign, PR-number fallback) ────
describe("branch arms left open by the happy path", () => {
  it("omits Authorization when getPreSignedUrl has no token (tokenless)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { url: "https://signed" }));
    await getPreSignedUrl({
      serviceParams: { commit: "c", slug: "a/b" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("keeps the GITHUB_REF pr when the event omits pull_request.number", () => {
    const params = buildServiceParams(
      {
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/pull/7/merge",
        GITHUB_SHA: "merge-sha",
      },
      {
        pull_request: { head: { sha: "head-sha" }, base: { sha: "base-sha" } },
      } as never,
    );
    expect(params.pr).toBe("7");
    expect(params.commit).toBe("head-sha");
    expect(params.compareSha).toBe("base-sha");
  });

  it("leaves compareSha null when the event has no base.sha", () => {
    const params = buildServiceParams({ GITHUB_SHA: "x" }, {
      pull_request: { number: 1, head: { sha: "h" } },
    } as never);
    expect(params.compareSha).toBeNull();
    expect(params.pr).toBe("1");
  });
});
