#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { rollup } from "rollup";
import config from "./rollup.config.mjs";

const SRC = resolve(import.meta.dirname, "../foliplus/js");
const DIST = resolve(import.meta.dirname, "../foliplus/dist");
mkdirSync(DIST, { recursive: true });

const components = readdirSync(SRC, { withFileTypes: true })
  .filter(
    d => d.isDirectory() && !["core", "common", "type", "runtime"].includes(d.name),
  )
  .map(d => d.name);

let ok = 0,
  fail = 0;
for (const name of components) {
  const entry = resolve(SRC, name, "index.ts");
  if (!existsSync(entry)) {
    console.log("SKIP", name);
    continue;
  }
  try {
    const c = config(name, entry);
    c.output.file = resolve(DIST, "foliplus-" + name + ".min.js");
    const bundle = await rollup(c);
    await bundle.write(c.output);
    await bundle.close();
    console.log("OK", name);
    ok++;
  } catch (e) {
    console.log("FAIL", name, ":", e.message);
    fail++;
  }
}
console.log("\nDone: " + ok + " OK, " + fail + " FAIL");
