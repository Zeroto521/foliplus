#!/usr/bin/env node
/* Wrapper for format_jinja_js.py — invoked by pre-commit with language: node */
const { spawnSync } = require("child_process");
const { resolve } = require("path");

const script = resolve(__dirname, "format_jinja_js.py");
const result = spawnSync("python3", [script, "--check"], {
  stdio: "inherit",
  cwd: resolve(__dirname, ".."),
});

process.exit(result.status ?? 1);
