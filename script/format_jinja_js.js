#!/usr/bin/env node
/* Wrapper for format_jinja_js.py — invoked by pre-commit with language: node */
const { spawnSync } = require("child_process");
const { resolve } = require("path");

const script = resolve(__dirname, "format_jinja_js.py");
const isCheck = process.argv.includes("--check");

// pre-commit with language:node sets PATH to include node_modules/.bin,
// but we need Python too. Try python3 first, fallback to python.
const python = spawnSync("which", ["python3"]).status === 0 ? "python3" : "python";
const result = spawnSync(python, [script, ...(isCheck ? ["--check"] : [])], {
  stdio: "inherit",
  cwd: resolve(__dirname, ".."),
});

process.exit(result.status ?? 1);
