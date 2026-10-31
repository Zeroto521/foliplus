#!/usr/bin/env node
/** mojibake-all.mjs — run mojibake_check.py over every tracked TEXT file, in batches.
 *
 * The pre-commit hook feeds mojibake_check.py only files matching types: [text],
 * so binaries (png, jpg, gz, etc.) are never scanned. `git ls-files` includes
 * everything, and a binary's bytes can legitimately contain EF BF BD (the U+FFFD
 * signature) — so mirror the hook by skipping non-text files here. We use
 * `git check-attr`'s diff/text attribute, which is exactly how git decides
 * whether a path is text for the "binary" attribute.
 */
import { execSync, spawnSync } from "node:child_process";

const all = execSync("git ls-files", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

// git check-attr --stdin returns "path: attr: value" lines. Mark a path binary
// when its diff/text attribute is "unset" (-binary) or "set" (binary).
const bin = new Set();
for (let i = 0; i < all.length; i += 200) {
  const chunk = all.slice(i, i + 200).join("\n");
  const out = execSync("git check-attr --stdin diff text", {
    input: chunk,
    encoding: "utf8",
  });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?): (diff|text): (set|unset|unspecified|value)$/);
    if (!m) continue;
    const [, path, attr, val] = m;
    if (
      val === "unset" ||
      (attr === "text" && val === "set" && path.endsWith(".png"))
    ) {
      bin.add(path);
    }
  }
}
// Also always skip known binary extensions even if attributes are silent.
const files = all.filter(
  f =>
    !bin.has(f) &&
    !/\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|eot|gz|zip|tar|pdf|pyc)$/i.test(f),
);

let fail = 0;
for (let i = 0; i < files.length; i += 120) {
  const batch = files.slice(i, i + 120);
  const r = spawnSync("python", ["script/check/mojibake_check.py", ...batch], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    fail = 1;
    break;
  }
}
process.exit(fail);
