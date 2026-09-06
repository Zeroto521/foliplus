#!/usr/bin/env node
/**
 * Zero-dependency CLI argument parser for foliplus build scripts.
 *
 * Pure function design — parseArgs never exits or prints. The caller
 * decides how to handle help/errors. This makes it testable in isolation.
 *
 * Usage:
 *   import { parseArgs, help } from "./args.mjs";
 *
 *   const spec = {
 *     dev:       { type: "bool"   },
 *     check:     { type: "bool"   },
 *     root:      { type: "string", default: ".", desc: "Project root directory" },
 *     threshold: { type: "number", default: 10 },
 *   };
 *
 *   const result = parseArgs(process.argv.slice(2), spec);
 *   if (result.help) { console.log(help(spec)); process.exit(0); }
 *   if (result.errors.length) { console.error(help(spec)); process.exit(1); }
 *
 * Supports:
 *   --flag            (boolean)
 *   --flag=value      (string)
 *   --flag value      (string, positional after flag)
 *   -d                (short flag, single-char)
 *   --help / -h       (set help=true, no error)
 *
 * Types: "bool", "string" (default), "number", "array". A non-numeric value
 * for a "number" flag is an error, not a silent coercion failure.
 */

/**
 * Parse argv into a result object. Never exits — caller handles help/errors.
 *
 * @param {string[]} argv — process.argv.slice(2)
 * @param {object} spec — flag spec (see above)
 * @returns {{ help: boolean, errors: string[], [flagName]: any }}
 */
export const parseArgs = (argv, spec) => {
  const result = {};
  for (const [name, meta] of Object.entries(spec)) {
    if (meta.type === "array") result[name] = [];
    else result[name] = meta.default ?? false;
  }

  result.help = false;

  result.errors = [];

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    // -h is always --help (checked before short-flag lookup)
    if (token === "-h") {
      result.help = true;
      return result;
    }

    // Short flags: -d -> --dev (resolved via spec)
    if (token.startsWith("-") && !token.startsWith("--") && token.length === 2) {
      const short = token.slice(1);
      // Look up which flag uses this short
      let resolved = null;
      for (const [name, meta] of Object.entries(spec)) {
        if (meta.short === short) {
          resolved = name;
          break;
        }
      }
      if (resolved) {
        result[resolved] = true;

        i++;
      } else {
        result.errors.push("Unknown short flag: " + token);

        i++;
      }
      continue;
    }

    if (token === "--help") {
      result.help = true;
      return result;
    }

    if (!token.startsWith("--")) {
      result.errors.push("Unknown argument: " + token);

      i++;
      continue;
    }

    const eqIdx = token.indexOf("=");
    const flag = token.slice(2, eqIdx === -1 ? undefined : eqIdx);
    const value = eqIdx === -1 ? null : token.slice(eqIdx + 1);

    if (!spec[flag]) {
      result.errors.push("Unknown flag: --" + flag);

      i++;
      continue;
    }

    const meta = spec[flag];

    if (meta.type === "bool") {
      if (value !== null) {
        result.errors.push("--" + flag + " is a boolean flag, does not take a value");

        i++;
      } else {
        result[flag] = true;

        i++;
      }
    } else if (meta.type === "array") {
      // --flag=a --flag=b --flag c
      if (value !== null) {
        result[flag].push(value);

        i++;
      } else {
        if (i + 1 >= argv.length) {
          result.errors.push("--" + flag + " requires a value");

          i++;
        } else {
          result[flag].push(argv[i + 1]);

          i += 2;
        }
      }
    } else {
      let raw = null;
      if (value !== null) {
        raw = value;

        i++;
      } else {
        if (i + 1 >= argv.length) {
          result.errors.push("--" + flag + " requires a value");

          i++;
        } else {
          raw = argv[i + 1];

          i += 2;
        }
      }
      // `type: "number"` is declared as a real type here (and advertised as `n`
      // in help), so it must coerce — otherwise the default is silently
      // replaced by a string, and `pct > threshold` compares against NaN.
      if (meta.type === "number") {
        if (raw !== null && raw.trim() !== "") {
          const n = Number(raw);
          if (Number.isFinite(n)) result[flag] = n;
          else result.errors.push("--" + flag + " must be a number: " + raw);
        } else if (raw !== null) {
          // `Number("")` is 0, which would masquerade as an explicit zero.
          result.errors.push("--" + flag + " requires a value");
        }
      } else if (raw !== null) {
        result[flag] = raw;
      }
    }
  }

  return result;
};

/**
 * Print a usage string with descriptions.
 */
export const help = spec => {
  const lines = ["Usage:"];
  for (const [name, meta] of Object.entries(spec)) {
    const typeHint =
      meta.type === "string" ? "path" : meta.type === "number" ? "n" : "value";
    let prefix = "  ";
    if (meta.short) prefix += "-" + meta.short + ", ";

    prefix += "--" + name;
    if (meta.type === "array") prefix += " [repeated]";
    else if (meta.type !== "bool") prefix += " <" + typeHint + ">";
    if (meta.desc) prefix += "  # " + meta.desc;

    lines.push(prefix);
  }
  return lines.join("\n");
};
