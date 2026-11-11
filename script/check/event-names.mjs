#!/usr/bin/env node
/**
 * Guard: semantic event-name convention over the event dictionary.
 *
 * Every value in `EVENTS` (core/event/const.ts) is a published wire name: a
 * subscriber recognises what an event means by its string, so a name that
 * drifts off the `<domain>:<action>` shape is a breaking change to every
 * listener, not a rename. This guard pins the shape:
 *
 *   - every value matches `foliplus:<domain>:<action>` — exactly three
 *     segments, each kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`), no empty segment;
 *   - the `layer` domain is non-empty (the layer panel is the primary
 *     publisher; an empty layer domain would mean the dictionary lost the
 *     panel wholesale);
 *   - every `layer`-domain value keeps the `foliplus:layer:` prefix — the
 *     prefix is the public contract a subscriber uses to route a layer
 *     event, so a layer event that spells a different prefix is a routing
 *     break, not a rename.
 *
 * Scope: the single source of event names, `foliplus/js/core/event/const.ts`.
 * Subscribers spell the constant (EVENTS.X), not the literal, so the
 * dictionary is the whole surface. `findEventNameDrift` takes the parsed
 * entries so a test can inject hypothetical names without mutating the
 * production constant; the CLI parses the file and feeds the real entries.
 *
 * Usage: `node script/check/event-names.mjs [root]`
 *   Prints each violation as `file:line: text` with a suggested fix and
 *   exits 1 when any are found.
 */
import fs from "node:fs";
import path from "node:path";

const CONST_REL = path.join("foliplus", "js", "core", "event", "const.ts");
/** `foliplus:<domain>:<action>` with every segment kebab-case. Three
 *  colon-separated segments; an empty segment (e.g. `foliplus:layer:`) fails. */
const NAME_RE = /^foliplus:([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Parse the `EVENTS = { ... } as const` literal out of the const.ts source.
 *  @returns [{key, value, line}] — `line` is the 1-based source line of the
 *  entry (where a CLI violation is reported). */
const parseEvents = source => {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(l => /^const EVENTS = \{/.test(l));
  if (start === -1) return [];
  const entries = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\} as const;/.test(lines[i])) break;
    const m = lines[i].match(/^\s*([A-Z_0-9]+):\s*"([^"]+)"/);
    if (m) entries.push({ key: m[1], value: m[2], line: i + 1 });
  }
  return entries;
};

/** Collect every naming violation in an `EVENTS` entry list.
 *  @param entries [{key, value, line}] — as `parseEvents` returns; `line` is
 *  optional (0 when absent, e.g. a test-injected entry).
 *  @param knownDomains Set of domain segments already published in the real
 *  dictionary (the CLI derives it from the same entries). A name whose domain
 *  is not in the set is a routing break — a subscriber listening for the
 *  panel's layer events will never see `foliplus:layerX:foo`. Omit it to
 *  check shape only (used by the empty-dictionary case, which must still
 *  report a missing layer domain rather than every unknown one).
 *  @returns [{key, value, line, reason, fix}] — one per violation. */
const findEventNameDrift = (entries, knownDomains) => {
  const violations = [];
  let hasLayer = false;
  for (const { key, value, line = 0 } of entries) {
    if (!NAME_RE.test(value)) {
      violations.push({
        key,
        value,
        line,
        reason: `value "${value}" is not \`foliplus:<domain>:<action>\` (three non-empty kebab-case segments)`,
        fix: "spell `foliplus:<domain>:<action>`; an empty segment (foliplus:layer:) has no action",
      });
      continue;
    }
    const domain = value.split(":")[1];
    if (domain === "layer") {
      hasLayer = true;
    } else if (knownDomains && !knownDomains.has(domain)) {
      violations.push({
        key,
        value,
        line,
        reason: `domain "${domain}" is not a published domain (foliplus:${domain}:…)`,
        fix: `use a domain the dictionary already publishes (${[...knownDomains].sort().join(", ")}) or add the new domain deliberately`,
      });
    }
  }
  if (entries.length > 0 && !hasLayer) {
    violations.push({
      key: "(dictionary)",
      value: "",
      line: 0,
      reason: "no `foliplus:layer:` event in EVENTS",
      fix: "the layer panel publishes through this bus; an empty layer domain means the dictionary lost it",
    });
  }
  return violations;
};

/** CLI entry — reads the real const.ts and feeds parseEvents into the pure
 *  checker. Only runs when executed directly, never when a test imports this. */
const main = (root = process.cwd()) => {
  const file = path.join(root, CONST_REL);
  const rel = path.relative(root, file).split(path.sep).join("/");
  const entries = parseEvents(fs.readFileSync(file, "utf8"));
  const knownDomains = new Set(entries.map(e => e.value.split(":")[1]).filter(Boolean));
  const violations = findEventNameDrift(entries, knownDomains);
  for (const v of violations) {
    const at = v.line > 0 ? `${rel}:${v.line}` : rel;
    console.log(`${at}: ${v.key}: ${v.reason}\n  fix: ${v.fix}`);
  }
  if (violations.length === 0) {
    console.log("event-names: every EVENTS value follows `foliplus:<domain>:<action>`");
  }
  return violations.length === 0 ? 0 : 1;
};

/** CLI entry — wire `main` to process.argv when (and only when) this file is
 *  the entry module. `runCli` is exported so a test can drive it in-process
 *  (a spawned subprocess is invisible to the parent's coverage collector). */
const runCli = (argv, entry) => {
  const invoked =
    entry !== undefined && path.resolve(entry) === path.resolve(process.argv[1] ?? "");
  if (!invoked) return;
  process.exitCode = main(argv[0] ? path.resolve(argv[0]) : process.cwd());
};
runCli(process.argv.slice(2), process.argv[1]);

export { NAME_RE, parseEvents, findEventNameDrift, main, runCli };
