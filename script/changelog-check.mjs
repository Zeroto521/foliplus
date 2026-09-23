// CHANGELOG.md invariants — sort-order and PR-number existence.
//
// Two rules are enforced:
//   1. Within each bullet, the sequence of `[#NNN]` labels is non-decreasing.
//   2. Between adjacent bullets in the same `### Section` of the same
//      `## [Version]` heading, the first-number is non-decreasing.
//      Ties are legal — a mega-PR (#122, #147, #48, #37) legitimately
//      shows up across multiple bullets, and its position in each is
//      defined by the first number only.
//
// A third check runs only in CI (when GITHUB_TOKEN + GITHUB_REPOSITORY are
// set): every referenced #NNN must exist as a real PR or issue in this
// repo. It hits `GET /repos/{owner}/{repo}/issues/{n}` — PRs come back
// there too, since GitHub treats PRs as a subset of issues.
//
// Modes:
//   --check  (default)  Report violations, exit 1. Used by CI.
//   --fix             Rewrite the file in place (stable sort of labels and
//                     blocks). Exit 0 on success, exit 1 if the line-level
//                     multiset invariant would be violated (no partial fix).
//
// The fix guard: each line is normalized by sorting its `[#NNN](url)`
// pairs in place, then the multiset of normalized lines is compared
// before and after the fix. This catches "moving numbers between lines"
// which a raw character-multiset check would miss — a line-level invariant
// is strictly stronger. If the multiset changes, the fix refuses to write.
//
// Parsing: only `[#NNN]` labels count. URL type (`/pull/`, `/tree/`,
// `/issues/`) is ignored for numbering; the label is the human-facing
// anchor. If a label and its URL disagree on the number, we warn — we
// don't fail, because `[#164](.../tree/164)` is a copy-paste wart that
// a human can fix later without breaking the ordering invariant.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_PATH = "CHANGELOG.md";
const PR_LABEL_RE = /\[#(\d+)\]/g;
const PR_LINK_RE = /\[#(\d+)\]\(([^)]+)\)/g;

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Extract every `[#NNN]` label in a line, in document order. */
const extractLabelNumbers = line => {
  const nums = [];
  PR_LABEL_RE.lastIndex = 0;
  let m;
  while ((m = PR_LABEL_RE.exec(line))) {
    nums.push(Number(m[1]));
  }
  return nums;
};

/**
 * Parse CHANGELOG.md into a flat list of bullet entries.
 * Sub-bullets (indented `- `) belong to their parent and are skipped.
 * Entries without any `[#NNN]` label get `firstNum: null` and skip
 * ordering checks — they have nothing to sort by.
 */
const parseEntries = text => {
  const lines = text.split("\n");
  const entries = [];
  let version = null;
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const vMatch = line.match(/^##\s+\[([^\]]+)\]/);
    if (vMatch) {
      version = vMatch[1];
      section = null;
      continue;
    }

    const sMatch = line.match(/^###\s+(\S+)/);
    if (sMatch) {
      section = sMatch[1];
      continue;
    }

    if (/^- /.test(line)) {
      const nums = extractLabelNumbers(line);
      entries.push({
        lineNo,
        version,
        section,
        firstNum: nums[0] ?? null,
        nums,
      });
    }
  }
  return entries;
};

/**
 * Emit a warning (not a violation) when a label's number disagrees with
 * the trailing number of its URL — the `[#164](.../tree/164)` class of
 * copy-paste wart. Warnings don't affect the exit code.
 */
const collectLabelUrlWarnings = (entries, text) => {
  const lines = text.split("\n");
  const warnings = [];
  for (const entry of entries) {
    const line = lines[entry.lineNo - 1] ?? "";
    PR_LINK_RE.lastIndex = 0;
    let m;
    while ((m = PR_LINK_RE.exec(line))) {
      const label = Number(m[1]);
      const tail = m[2].match(/\/(\d+)$/);
      if (tail && Number(tail[1]) !== label) {
        warnings.push({
          lineNo: entry.lineNo,
          message: `label #${label} doesn't match URL tail /${tail[1]}`,
        });
      }
    }
  }
  return warnings;
};

// ── Check ────────────────────────────────────────────────────────────────────

/**
 * Check the two ordering invariants. Returns a list of `{lineNo, message}`.
 * Non-decreasing throughout — equal is allowed (mega-PR ties).
 */
const checkOrdering = entries => {
  const violations = [];

  for (const entry of entries) {
    for (let i = 0; i < entry.nums.length - 1; i++) {
      if (entry.nums[i] > entry.nums[i + 1]) {
        violations.push({
          lineNo: entry.lineNo,
          message: `numbers [${entry.nums.join(", ")}] → expected non-decreasing`,
        });
      }
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (prev.version !== cur.version || prev.section !== cur.section) continue;
    if (prev.firstNum === null || cur.firstNum === null) continue;
    if (cur.firstNum < prev.firstNum) {
      violations.push({
        lineNo: cur.lineNo,
        message: `first-number ${cur.firstNum} < previous entry's ${prev.firstNum} (line ${prev.lineNo})`,
      });
    }
  }

  return violations;
};

/**
 * Fetch each referenced #NNN against the repo's issues endpoint. PRs
 * come back through the same endpoint. A 404 means the number doesn't
 * exist — either the author invented it or mis-copied it from another
 * repo. A 403/429 is a rate-limit or scope error, which we surface
 * but do not fail on (the CI is still green; the human investigates).
 */
const checkExistence = async (entries, { owner, repo, token }) => {
  const nums = [...new Set(entries.flatMap(e => e.nums))].sort((a, b) => a - b);
  const byNum = new Map();
  for (const e of entries) {
    for (const n of e.nums) {
      if (!byNum.has(n)) byNum.set(n, e.lineNo);
    }
  }

  const violations = [];
  let rateLimited = false;

  for (const num of nums) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${num}`;
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch (err) {
      return {
        violations,
        error: `GitHub API unreachable for #${num}: ${err.message}`,
      };
    }
    if (resp.status === 404) {
      violations.push({
        lineNo: byNum.get(num),
        message: `#${num} not found in ${owner}/${repo} (no PR or issue)`,
      });
    } else if (resp.status === 403 || resp.status === 429) {
      rateLimited = true;
      break;
    }
  }

  return {
    violations,
    error: rateLimited ? "GitHub API rate-limited — partial results" : null,
  };
};

// ── Fix ──────────────────────────────────────────────────────────────────────

/**
 * Sort the `[#NNN](url)` pairs within a single bullet line, stably by
 * number. Only acts when all pairs are adjacent (separated by exactly
 * ", ") — otherwise the line is left alone and the check will flag it.
 * Returns the (possibly modified) line.
 */
const sortLinePairs = line => {
  const pairs = [];
  const re = /\[#(\d+)\]\([^)]+\)/g;
  let m;
  while ((m = re.exec(line))) {
    pairs.push({
      text: m[0],
      num: Number(m[1]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  if (pairs.length <= 1) return line;

  // Verify pairs are adjacent (separated by ", ")
  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1];
    const cur = pairs[i];
    if (cur.start !== prev.end + 2 || line.slice(prev.end, cur.start) !== ", ") {
      return line;
    }
  }

  const sorted = [...pairs].sort((a, b) => a.num - b.num);
  if (sorted.every((p, i) => p === pairs[i])) return line;

  const rangeStart = pairs[0].start;
  const rangeEnd = pairs[pairs.length - 1].end;
  const sortedRange = sorted.map(p => p.text).join(", ");
  return line.slice(0, rangeStart) + sortedRange + line.slice(rangeEnd);
};

/**
 * Stable bubble sort by firstNum. Null-firstNum blocks are never moved —
 * they have no position in the sorted order. Ties (equal firstNum) keep
 * their relative order (JS sort is stable by spec, but we use bubble
 * sort here to handle null-skip explicitly).
 */
const stableBubbleSortByFirstNum = blocks => {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].firstNum === null || blocks[i - 1].firstNum === null) continue;
      if (blocks[i].firstNum < blocks[i - 1].firstNum) {
        [blocks[i], blocks[i - 1]] = [blocks[i - 1], blocks[i]];
        changed = true;
      }
    }
  }
};

/**
 * Parse a range of lines into blocks. Each block is a bullet (line
 * starting with "- " at col 0) plus any following indented lines
 * (sub-bullets). Blank lines within the range are treated as part of
 * the preceding block (the CHANGELOG doesn't have them between bullets
 * and their sub-bullets, but we handle it gracefully).
 */
const parseBlocks = (lines, startIdx, endIdx) => {
  const blocks = [];
  let current = null;

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    if (/^- /.test(line)) {
      if (current) blocks.push(current);
      const nums = extractLabelNumbers(line);
      current = {
        lines: [line],
        firstNum: nums[0] ?? null,
        nums,
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks;
};

// ── Guard (line-level multiset invariant) ────────────────────────────────────

/**
 * Normalize each line by sorting its `[#NNN](url)` pairs in place,
 * then return a multiset (line → count) of the normalized lines.
 * This is the guard for the fix: if the multiset changes, the fix
 * has moved numbers between lines, which is a silent corruption.
 */
const normalizedLineMultiset = text => {
  const counts = new Map();
  for (const line of text.split("\n")) {
    const normalized = sortLinePairs(line);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
};

const sameLineMultiset = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [line, count] of a) {
    if (b.get(line) !== count) return false;
  }
  return true;
};

/**
 * Fix the file: within-line label sort + between-block stable sort.
 * Returns `{ newText, changed, error }`. If `error` is non-null, the
 * line-level multiset invariant was violated and `newText` is NOT safe
 * to write (the caller must not partially apply).
 */
const fixFile = text => {
  const lines = text.split("\n");
  const originalLines = normalizedLineMultiset(text);

  // Find all subsection headers
  const subsectionHeaders = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("### ")) subsectionHeaders.push(i);
  }

  // Process each subsection (in reverse order so earlier edits don't
  // shift later indices).
  for (let s = subsectionHeaders.length - 1; s >= 0; s--) {
    const headerIdx = subsectionHeaders[s];
    const nextHeaderIdx =
      s + 1 < subsectionHeaders.length ? subsectionHeaders[s + 1] : lines.length;

    // Find the block range: first bullet after the header, last non-blank
    // line before the next subsection or section header.
    let startIdx = -1;
    let endIdx = -1;
    for (let i = headerIdx + 1; i < nextHeaderIdx; i++) {
      // Stop at a section header (## without ###)
      if (/^##\s/.test(lines[i]) && !lines[i].startsWith("### ")) break;
      if (/^- /.test(lines[i])) {
        if (startIdx === -1) startIdx = i;
        endIdx = i + 1;
      }
    }
    if (startIdx === -1) continue;

    // Extend endIdx past sub-bullets of the last bullet
    while (
      endIdx < nextHeaderIdx &&
      !/^- /.test(lines[endIdx]) &&
      !/^\s*$/.test(lines[endIdx])
    ) {
      endIdx++;
    }

    // Parse blocks
    const blocks = parseBlocks(lines, startIdx, endIdx);

    // Fix within-line ordering
    for (const block of blocks) {
      block.lines[0] = sortLinePairs(block.lines[0]);
    }

    // Fix between-block ordering
    stableBubbleSortByFirstNum(blocks);

    // Reconstruct
    const newLines = [];
    for (const block of blocks) {
      newLines.push(...block.lines);
    }

    // Apply edit (reverse order, so indices stay valid)
    lines.splice(startIdx, endIdx - startIdx, ...newLines);
  }

  const newText = lines.join("\n");
  const newLines = normalizedLineMultiset(newText);

  if (!sameLineMultiset(originalLines, newLines)) {
    return {
      newText,
      changed: false,
      error: "line-level multiset invariant violated — refusing to write a partial fix",
    };
  }

  return { newText, changed: newText !== text, error: null };
};

// ── CLI ──────────────────────────────────────────────────────────────────────

const parseCliArgs = argv => {
  const opts = {
    path: DEFAULT_PATH,
    fix: false,
    skipExists: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" && argv[i + 1]) opts.path = argv[++i];
    else if (a.startsWith("--path=")) opts.path = a.slice("--path=".length);
    else if (a === "--fix") opts.fix = true;
    else if (a === "--skip-exists") opts.skipExists = true;
  }
  return opts;
};

const main = async () => {
  const opts = parseCliArgs(process.argv.slice(2));
  let text;
  try {
    text = readFileSync(opts.path, "utf-8");
  } catch (err) {
    console.error(`[changelog-order] cannot read ${opts.path}: ${err.message}`);
    process.exit(2);
  }

  if (opts.fix) {
    // Fix mode: rewrite the file, skip existence check.
    const { newText, changed, error } = fixFile(text);
    if (error) {
      console.error(`[changelog-order] ERROR: ${error}`);
      process.exit(1);
    }
    if (!changed) {
      console.log(`[changelog-order] ${opts.path}: already sorted`);
      return;
    }
    writeFileSync(opts.path, newText, "utf-8");
    console.log(`[changelog-order] ${opts.path}: fixed`);
    return;
  }

  // Check mode (default).
  const entries = parseEntries(text);
  const orderViolations = checkOrdering(entries);
  const warnings = collectLabelUrlWarnings(entries, text);

  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const token = process.env.GITHUB_TOKEN;
  const shouldCheck = !opts.skipExists && owner && repo && token;

  console.log(`[changelog-order] ${opts.path}: ${entries.length} bullet entries`);

  for (const v of orderViolations) {
    console.log(`  ${opts.path}:${v.lineNo} ${v.message}`);
  }

  let existViolations = [];
  if (shouldCheck) {
    const result = await checkExistence(entries, { owner, repo, token });
    if (result.error) {
      console.log(`  existence-check: ${result.error}`);
    }
    existViolations = result.violations;
    for (const v of existViolations) {
      console.log(`  ${opts.path}:${v.lineNo} ${v.message}`);
    }
  } else {
    const why = opts.skipExists
      ? "--skip-exists"
      : "no GITHUB_TOKEN + GITHUB_REPOSITORY";
    console.log(`  existence-check: skipped (${why})`);
  }

  for (const w of warnings) {
    console.log(`  ${opts.path}:${w.lineNo} warn: ${w.message}`);
  }

  const total = orderViolations.length + existViolations.length;
  if (total > 0) {
    console.log(`\nFAIL: ${total} violation(s)`);
    process.exit(1);
  }
  console.log(`\nOK: no violations`);
};

export {
  parseEntries,
  extractLabelNumbers,
  collectLabelUrlWarnings,
  checkOrdering,
  checkExistence,
  stableBubbleSortByFirstNum,
  sortLinePairs,
  fixFile,
  normalizedLineMultiset,
  sameLineMultiset,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
