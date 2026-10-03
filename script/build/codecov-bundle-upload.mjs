#!/usr/bin/env node
/**
 * Codecov Bundle Analysis upload — thin client for the bundler-plugin HTTP
 * protocol. Official plugins (Rollup/Vite/Webpack) own their own bundler
 * hooks; esbuild has none, so this script speaks the same two calls they do:
 *
 *   1. POST {apiUrl}/upload/bundle_analysis/v1  →  { url: <presigned> }
 *   2. PUT  <presigned>  body: OutputPayload JSON
 *
 * Protocol source:
 *   codecov/codecov-javascript-bundler-plugins
 *   packages/bundler-plugin-core/src/utils/{getPreSignedURL,uploadStats,preProcessBody}.ts
 *
 * Fail-soft by design in CI (`continue-on-error: true` on the step): a failed
 * upload must never block the dual size gates, the sticky PR table, or merge.
 *
 * Usage:
 *   node script/build/codecov-bundle-upload.mjs --metafile=bundle-metafile.json
 *   node script/build/codecov-bundle-upload.mjs --metafile=... --out=payload.json  # convert only
 *   node script/build/codecov-bundle-upload.mjs --metafile=... --dry-run           # convert + print, no network
 *
 * Auth: `CODECOV_TOKEN` env (same GHA secret the coverage uploads use).
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { help, parseArgs } from "../args.mjs";
import { OK, WARN } from "../glyph.mjs";
import { buildCodecovPayload, payloadToJson } from "./codecov-bundle-report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const DEFAULT_API_URL = "https://api.codecov.io";
const API_ENDPOINT = "/upload/bundle_analysis/v1";

const OWNER_SLUG_JOIN = ":::";
const REPO_SLUG_JOIN = "::::";

const SPEC = {
  root: { type: "string", default: ROOT, desc: "Project root" },
  metafile: {
    type: "string",
    default: "bundle-metafile.json",
    desc: "Merged esbuild metafile path (relative to root or absolute)",
  },
  "bundle-name": {
    type: "string",
    default: "foliplus",
    desc: "Codecov bundleName (must match /^[\\w\\d_:/@\\.{}\\[\\]$-]+$/)",
  },
  out: {
    type: "string",
    desc: "Write the OutputPayload JSON here and skip the network",
  },
  "dry-run": {
    type: "bool",
    desc: "Build + print the payload; do not contact Codecov",
  },
  "api-url": {
    type: "string",
    default: DEFAULT_API_URL,
    desc: "Codecov API base URL",
  },
};

/**
 * Slug encoding from preProcessBody.ts: `owner/repo` → `owner::::repo`, with
 * each `/` inside the owner segment becoming `:::`. The API expects this form;
 * do not "simplify" to the display slug.
 */
const encodeSlug = slug => {
  const repoIndex = slug.lastIndexOf("/") + 1;
  const owner = slug.substring(0, repoIndex).trimEnd();
  const repo = slug.substring(repoIndex, slug.length);
  if (owner === "" || repo === "") {
    throw new Error("Invalid owner and/or repo");
  }
  const encodedOwner = owner.split("/").join(OWNER_SLUG_JOIN).slice(0, -3);
  return [encodedOwner, repo].join(REPO_SLUG_JOIN);
};

/** Empty strings become null — preProcessBody contract. */
const preProcessBody = body => {
  const out = { ...body };
  for (const [key, value] of Object.entries(out)) {
    if (key === "slug" && typeof value === "string") {
      out[key] = encodeSlug(value);
    }
    if (!value || value === "") {
      out[key] = null;
    }
  }
  return out;
};

/**
 * Service params from GitHub Actions env + event payload (mirrors
 * GitHubActions.ts, minus the optional jobs-API build URL — not needed for
 * a successful upload).
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {object|null} [event] GITHUB_EVENT_PATH JSON, when present
 */
const buildServiceParams = (env = process.env, event = null) => {
  const headRef = env.GITHUB_HEAD_REF || "";
  const ref = env.GITHUB_REF || "";

  let branch = null;
  const branchMatch = /refs\/heads\/(.*)/.exec(ref);
  if (branchMatch) branch = branchMatch[1];
  if (headRef) branch = headRef;

  let pr = null;
  const prMatch = /refs\/pull\/([0-9]+)\/merge/.exec(ref);
  if (prMatch) pr = prMatch[1];

  let commit = env.GITHUB_SHA || null;
  if (event?.pull_request?.head?.sha) {
    commit = event.pull_request.head.sha;
    // Prefer the PR number from the event when GITHUB_REF is not the merge ref.
    pr = String(event.pull_request.number ?? pr);
  }

  return {
    branch,
    build: env.GITHUB_RUN_ID || null,
    buildURL: null,
    commit,
    compareSha: event?.pull_request?.base?.sha ?? null,
    job: env.GITHUB_WORKFLOW || null,
    pr,
    service: env.GITHUB_ACTIONS ? "github-actions" : "github",
    slug: env.GITHUB_REPOSITORY || null,
  };
};

/** Load the PR event JSON GHA writes for `pull_request` runs, if any. */
const loadEvent = (env = process.env) => {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
};

/** POST the presign request; returns the upload URL. */
const getPreSignedUrl = async ({
  apiUrl = DEFAULT_API_URL,
  token,
  serviceParams,
  fetchImpl = fetch,
}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `token ${token}`;

  const body = preProcessBody(serviceParams);
  const response = await fetchImpl(`${apiUrl}${API_ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `get-pre-signed-url failed: ${response.status} ${response.statusText} ${detail}`.trim(),
    );
  }
  const data = await response.json();
  if (!data?.url) {
    throw new Error("get-pre-signed-url response missing `url`");
  }
  return data.url;
};

/** PUT the OutputPayload JSON to the presigned URL. */
const uploadStats = async ({ preSignedUrl, message, fetchImpl = fetch }) => {
  const response = await fetchImpl(preSignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: message,
  });
  if (!response.ok) {
    throw new Error(`upload-stats failed: ${response.status} ${response.statusText}`);
  }
  return true;
};

/**
 * Convert a metafile (and optionally upload). Returns a result object so
 * unit tests never call `process.exit`.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {string} [opts.metafile]
 * @param {string} [opts.bundleName]
 * @param {string|null} [opts.out] write payload JSON here and skip the network
 * @param {boolean} [opts.dryRun]
 * @param {string} [opts.apiUrl]
 * @param {string} [opts.token]
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {object|null} [opts.event]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{payload: object, message: string, uploaded: boolean, url?: string, wrote?: string}>}
 */
const runUpload = async ({
  root = ROOT,
  metafile = "bundle-metafile.json",
  bundleName = "foliplus",
  out = null,
  dryRun = false,
  apiUrl = DEFAULT_API_URL,
  token = process.env.CODECOV_TOKEN,
  env = process.env,
  event = loadEvent(env),
  fetchImpl = fetch,
} = {}) => {
  const metafilePath = resolve(root, metafile);
  const parsed = JSON.parse(readFileSync(metafilePath, "utf-8"));
  const payload = buildCodecovPayload({
    metafile: parsed,
    root,
    bundleName,
  });
  const message = payloadToJson(payload);

  if (out) {
    const outPath = resolve(root, out);
    writeFileSync(outPath, `${message}\n`, "utf-8");
    return { payload, message, uploaded: false, wrote: outPath };
  }

  if (dryRun) {
    return { payload, message, uploaded: false };
  }

  if (!token) {
    throw new Error("CODECOV_TOKEN is not set; refusing to upload");
  }

  const serviceParams = buildServiceParams(env, event);
  const url = await getPreSignedUrl({
    apiUrl,
    token,
    serviceParams,
    fetchImpl,
  });
  await uploadStats({ preSignedUrl: url, message, fetchImpl });
  return { payload, message, uploaded: true, url };
};

/** CLI entry: parse argv, run the upload, and exit. Exported so tests can
 *  drive the exact CLI flow with an injected argv instead of spawning a
 *  process. */
const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv, SPEC);
  if (args.help) {
    console.log(help(SPEC));
    process.exit(0);
  }
  if (args.errors.length) {
    console.error(args.errors.join("\n"));
    console.error(help(SPEC));
    process.exit(1);
  }

  try {
    const result = await runUpload({
      root: resolve(args.root),
      metafile: args.metafile,
      bundleName: args["bundle-name"],
      out: args.out || null,
      dryRun: Boolean(args["dry-run"]),
      apiUrl: args["api-url"],
    });
    if (result.wrote) {
      console.log(
        `${OK} wrote ${result.wrote} (${result.payload.assets.length} assets)`,
      );
    } else if (result.uploaded) {
      console.log(
        `${OK} uploaded bundle \`${result.payload.bundleName}\` (${result.payload.assets.length} assets)`,
      );
    } else {
      console.log(result.message);
    }
  } catch (e) {
    if (String(e.message).includes("CODECOV_TOKEN")) {
      console.error(`${WARN} ${e.message}`);
    } else {
      console.error(e);
    }
    process.exit(1);
  }
};

export {
  buildServiceParams,
  encodeSlug,
  getPreSignedUrl,
  loadEvent,
  main,
  preProcessBody,
  runUpload,
  uploadStats,
};

// CLI entry point: `node script/codecov-bundle-upload.mjs [options]`.
// Guarded so importing this module (e.g. for tests) has no side effects.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
