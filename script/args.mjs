#!/usr/bin/env node
/**
 * Minimal zero-dependency argument parser for foliplus build scripts.
 *
 * Usage:
 *   import { parseArgs, usage } from "./args.mjs";
 *   const spec = { root: { type: "string", default: "." }, dev: { type: "bool" } };
 *   const args = parseArgs(process.argv.slice(2), spec);
 *
 * Supports:
 *   --flag        (boolean)
 *   --name=value  (string)
 *   --name value  (string, positional after flag)
 *   --help / -h   (prints usage, exits 0)
 *
 * Unknown flags cause an error + usage print + exit 1.
 */

export function parseArgs(argv, spec) {
  const result = {};
  for (const [name, meta] of Object.entries(spec)) result[name] = meta.default ?? false;

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      console.log(usage(spec));
      process.exit(0);
    }

    if (!token.startsWith("--")) {
      console.error(`Error: unknown argument "${token}"`);
      console.error(usage(spec));
      process.exit(1);
    }

    const eqIdx = token.indexOf("=");
    const flag = token.slice(2, eqIdx === -1 ? undefined : eqIdx);
    const value = eqIdx === -1 ? null : token.slice(eqIdx + 1);

    if (!spec[flag]) {
      console.error(`Error: unknown flag "--${flag}"`);
      console.error(usage(spec));
      process.exit(1);
    }

    if (spec[flag].type === "bool") {
      if (value !== null) {
        console.error(`Error: --${flag} is a boolean flag, does not take a value`);
        process.exit(1);
      }
      result[flag] = true;
      i++;
    } else {
      if (value !== null) {
        result[flag] = value;
        i++;
      } else {
        if (i + 1 >= argv.length) {
          console.error(`Error: --${flag} requires a value`);
          process.exit(1);
        }
        result[flag] = argv[i + 1];
        i += 2;
      }
    }
  }

  return result;
}

export function usage(spec) {
  const lines = ["Usage:"];
  for (const [name, meta] of Object.entries(spec)) {
    if (meta.type === "bool") lines.push(`  --${name}`);
    else lines.push(`  --${name} <${meta.default === undefined ? "value" : meta.default}>`);
  }
  return lines.join("\n");
}