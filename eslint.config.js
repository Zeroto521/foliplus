// ESLint flat config — the auto-discovered entry point.
//
// The rules live in `config/eslint/`, because this file is the one thing that
// must stay at the repository root: a bare `eslint .` and editor integrations
// find the config by walking up to `eslint.config.*`, and none of them accept a
// path. Re-exporting keeps that discovery working while the 400+ lines of rule
// definitions sit with the tooling they configure.
//
// `--config` callers (`npm run lint` / `npm run typecheck`) point straight at
// `config/eslint/typed.mjs` and never import this file, so the two paths cannot
// drift into different configs.
export { default } from "./config/eslint/base.mjs";
