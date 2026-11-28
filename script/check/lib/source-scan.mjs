// script/check/lib/source-scan — one shared source scanner for the class/literal guards: comment stripping, source walking and const object-literal parsing.
//
// Every guard used to carry its own copy of "walk the tree + strip comments"
// (and several spell the object-map parser differently), so a drift in one
// guard's reading of the source could hide a violation another guard caught.
// This module owns the three primitives the guards share:
//
//   - stripComments(src): block + line comments → spaces, newlines preserved,
//     so a reported line number still points at the real code line and a doc
//     comment naming a class never counts as a spelling of it;
//   - collectSources(dir, opts): recursive walk returning source files,
//     honouring a suffix allow-list and a skip-dir set;
//   - parseClassDefs(src): parse every `const NAME = { ... }` owner map
//     (single-line, multi-line and nested) plus every file-level
//     `const NAME = "..."` named const, into {token, key, owner, line} sites.
//
// The object-literal parser is deliberately tolerant: it brace-matches the
// declaration and collects every `KEY: "value"` string entry inside it at any
// nesting depth, attributing them to the enclosing const. Composite values
// ("a foliplus-x foliplus-y") and selector strings (".foliplus-x") are still
// single strings — the caller decides what counts as a token, so a composite
// never accidentally claims one of its parts. Like the predecessor, only a
// column-0 `const` / `export const` declaration is an owner site, so a
// function-local map is not misread as a class vocabulary.
import fs from "node:fs";
import path from "node:path";

/** A single foliplus class token, exactly. */
const TOKEN_RE = /^foliplus-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Strip block + line comments, preserving newlines so line numbers survive.
 *
 * String-aware: a `//` or `/*` inside a string literal (a URL, a regex-ish
 * value, a data URI) is content, not a comment — blanking it would corrupt the
 * string and could hide a class token that follows it on the same line. Only a
 * comment outside a string is replaced (by spaces, so the source length and
 * every line number stay identical).
 */
const stripComments = src => {
  let out = "";
  let i = 0;
  let inString = null; // '"' or "'"
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      out += " ";
      i += 1;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" || src[i] === "\r" ? src[i] : " ";
        i += 1;
      }
      if (i < src.length) {
        out += " ";
        i += 1;
      }
      if (i < src.length) {
        out += " ";
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

/** Recursively collect source files under `dir`, skipping `skipDirs`. */
const collectSources = (
  dir,
  {
    suffixes = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
    skipDirs = new Set(),
    out = [],
  } = {},
) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, { suffixes, skipDirs, out });
    else if (suffixes.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const IDENT_RE = /[A-Za-z_$][\w$]*/;

/** Line number (1-based) of the absolute `index` in `src`. */
const lineAt = (src, index) => src.slice(0, index).split("\n").length;

/**
 * Parse every column-0 `const NAME = { ... }` object literal (optionally
 * `export`ed, optionally `as const`) and every column-0
 * `const NAME = "..."` named const into owner sites.
 *
 * @returns {{token: string, key: string, owner: string, line: number}[]}
 */
const parseClassDefs = source => {
  const code = stripComments(source);
  const sites = [];

  // Object maps: `const NAME = {` / `export const NAME = {` at column 0.
  const mapRe = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gm;
  let m;
  while ((m = mapRe.exec(code)) !== null) {
    const owner = m[1];
    const open = m.index + m[0].length - 1; // index of '{'
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '"' || ch === "'") {
        const q = ch;
        i += 1;
        while (i < code.length && code[i] !== q) {
          if (code[i] === "\\") i += 1;
          i += 1;
        }
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;
    const body = code.slice(open + 1, close);
    let j = 0;
    while (j < body.length) {
      const ch = body[j];
      if (ch === '"' || ch === "'") {
        const q = ch;
        j += 1;
        while (j < body.length && body[j] !== q) {
          if (body[j] === "\\") j += 1;
          j += 1;
        }
        j += 1;
        continue;
      }
      if (ch === "{" || ch === "}") {
        j += 1;
        continue;
      }
      if (IDENT_RE.test(ch)) {
        const idMatch = body.slice(j).match(IDENT_RE);
        const key = idMatch[0];
        let k = j + key.length;
        while (k < body.length && /\s/.test(body[k])) k += 1;
        if (body[k] === ":") {
          let v = k + 1;
          while (v < body.length && /\s/.test(body[v])) v += 1;
          if (body[v] === '"') {
            let s = v + 1;
            while (s < body.length && body[s] !== '"') {
              if (body[s] === "\\") s += 1;
              s += 1;
            }
            const value = body.slice(v + 1, s);
            if (TOKEN_RE.test(value)) {
              sites.push({
                token: value,
                key,
                owner,
                line: lineAt(code, open + 1 + j),
              });
            }
            j = s + 1;
            continue;
          }
        }
        j = k;
        continue;
      }
      j += 1;
    }
  }

  // File-level named consts: `const X = "..."` / `export const X = "...";`.
  const namedRe = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"\s*;\s*$/gm;
  while ((m = namedRe.exec(code)) !== null) {
    if (TOKEN_RE.test(m[2])) {
      sites.push({ token: m[2], key: m[1], owner: m[1], line: lineAt(code, m.index) });
    }
  }

  return sites;
};

export { TOKEN_RE, collectSources, parseClassDefs, stripComments };
