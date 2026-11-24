# `script/` — Developer tooling

Build the bundle, run the static guards, scaffold a new control. One directory,
organised by _function_, not by language.

## Layout

| Path       | Purpose                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args.mjs` | Zero-dependency CLI argument parser shared by `build/`, `check/` and `tool/`. Stays at the root by convention — a single shared util does not need a `lib/` directory. |
| `build/`   | JS bundle pipeline (esbuild config, PostCSS, registry scanner, dist-mode marker, glyph table, version resolver).                                                       |
| `check/`   | Static guards. Each file is one rule; the suffix tells you the language.                                                                                               |
| `tool/`    | Developer scaffolding (`new-control.mjs`).                                                                                                                             |

## Language ownership

Each guard is written in the toolchain of the tree it inspects:

- `.mjs` guards check `foliplus/js/**` and `script/` itself (import boundaries,
  duplicate class definitions, listener leaks, popup placement, …).
- `.py` guards check `foliplus/**/*.py` (module size, docstring reST validity,
  CHANGELOG ordering, mojibake in staged files, …).

**We deliberately do not unify the language.** Using each inspected tree's own
toolchain keeps parsing and AST access cheap; a single-language rule would mean
cross-language parsing (tree-sitter or shelling out) with zero benefit.

## Cross-language exceptions

Two `.py` files inspect the JS tree. They are intentional, not oversights:

| File                          | What it checks                                                   | Why Python                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check/dead_barrel_export.py` | Dead exports in `foliplus/js` with zero consumers repo-wide.     | Lives alongside the other barrel/registry guards that share the Python pre-commit group; the JS equivalent would duplicate the tree-walk logic already in this file. |
| `check/style_check.py`        | Code-style rules on `foliplus/js/*.ts` and `foliplus/css/*.css`. | Predates the eslint config consolidation; the rules were written against Python's `re` engine and have no direct eslint equivalent.                                  |

A third file joined this group for the CONFIG contract specifically:
`check/config_key_style.py` reads the `foliplus/js/config-schema.ts` declaration
(and, with `--dump`, the Python schema dump) to prove every Python→JS payload key
is snake_case. It is stdlib-only on purpose so the pre-commit hook runs in the
isolated hook env; the generation-drift half needs Python plus Node and lives in
`make config-schema-verify` (wired into the CI python job).

If you are about to add a new guard that inspects `foliplus/js/**`, prefer `.mjs`
unless you have a concrete reason not to.

## Adding a new guard

1. **File naming**: `check/` uses kebab-case for `.mjs` (`my-guard.mjs`) and
   snake_case for `.py` (`my_check.py`).
2. **Mirror test**: every module must have a corresponding test file under
   `test/js/script/check/` (`.mjs`) or `test/python/script/check/` (`.py`). The
   `toolchain-guard` vitest suite enforces this 1:1 mapping.
3. **Hook registration**: add the guard to `.pre-commit-config.yaml` so it runs
   in `pre-commit.ci` on every PR. The `smoke_wheel.py` guard is the only
   exception — it runs in the release workflow instead (see below).
4. **Private helpers**: module-private functions take a `_` prefix.

## Guard runtime matrix

| Guard                   | Runs where                                                  |
| ----------------------- | ----------------------------------------------------------- |
| `changelog_check.py`    | pre-commit.ci                                               |
| `mojibake_check.py`     | pre-commit.ci                                               |
| `style_check.py`        | pre-commit.ci                                               |
| `dead_barrel_export.py` | pre-commit.ci                                               |
| `bare_reload.py`        | pre-commit.ci                                               |
| `docstring_check.py`    | pre-commit.ci                                               |
| `module_size_check.py`  | pre-commit.ci                                               |
| `config_key_style.py`   | pre-commit.ci + `make config-schema-verify` (CI python job) |
| `smoke_wheel.py`        | `release` workflow (sdist + wheel jobs)                     |
