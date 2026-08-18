import esbuild from 'rollup-plugin-esbuild';
import terser from '@rollup/plugin-terser';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { transformSource } from './compress.mjs';

const SRC = resolve(import.meta.dirname, '../foliplus/js');

const DECL_RE = /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_RE = /export\s*\{([^}]+)\}/g;
const STAR_RE = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_RE = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const exportNames = list => list
  .split(',')
  .map(p => { const t = p.trim(); const m = t.match(/^(.+?)\s+as\s+(.+)$/); return m ? m[2].trim() : t; })
  .filter(n => n && !n.startsWith('type'));

function collectExports(fp, seen = new Set(), depth = 0) {
  const p = existsSync(fp) ? fp : fp.replace(/\.js$/, '.ts');
  if (depth > 6 || seen.has(p) || !existsSync(p)) return [];
  seen.add(p);
  const s = readFileSync(p, 'utf-8');
  const n = new Set();
  let m;
  while ((m = DECL_RE.exec(s))) n.add(m[1]);
  while ((m = NAMED_RE.exec(s))) exportNames(m[1]).forEach(x => n.add(x));
  while ((m = STAR_RE.exec(s))) collectExports(resolve(dirname(p), m[1]), seen, depth + 1).forEach(x => n.add(x));
  while ((m = RE_EXPORT_RE.exec(s))) {
    exportNames(m[1]).forEach(x => n.add(x));
    collectExports(resolve(dirname(p), m[2]), seen, depth + 1).forEach(x => n.add(x));
  }
  return [...n];
}

function ns(spec) {
  if (spec === '#foliplus/BaseControl.js') return 'foliplus.BaseControl';
  if (spec === '#core/hint.js') return 'foliplus.hint';
  if (spec === '#core/component.js') return 'foliplus.core.component';
  if (spec === '#core/mode.js') return 'foliplus.core.mode';
  const m = spec.match(/^#core\/([^/]+)\//);
  if (m) return 'foliplus.core.' + m[1];
  const r = spec.replace(/^#common\//, '').replace(/\.js$/, '');
  return 'foliplus.common.' + r;
}

const shimPlugin = {
  name: 'foliplus-global-namespace',
  resolveId(s) {
    if (/^#(core|common|foliplus)\//.test(s)) return '\0shim:' + s;
    return null;
  },
  load(id) {
    if (!id.startsWith('\0shim:')) return null;
    const spec = id.slice('\0shim:'.length);
    const rel = spec.replace(/^#core\//, 'core/').replace(/^#common\//, 'common/').replace(/^#foliplus\//, '');
    const names = collectExports(resolve(SRC, rel));
    const sn = ns(spec).replace(/\./g, '_') + '_shim';
    const code = ['var ' + sn + ' = globalThis.' + ns(spec) + ';', ...names.map(n => 'export const ' + n + ' = ' + sn + '.' + n + ';')].join('\n');
    return { code, map: null };
  },
};

const sourceTransform = {
  name: 'source-transform',
  transform(code) {
    return { code: transformSource(code), map: null };
  },
};

export default (name, entry) => ({
  input: entry,
  output: {
    file: resolve(SRC, '../dist/foliplus-' + name + '.min.js'),
    format: 'iife',
    globals: { leaflet: 'L' },
    banner: '/*! foliplus ' + name + ' (rollup) */\n',
    plugins: [terser()],
  },
  treeshake: { propertyReadSideEffects: false },
  plugins: [sourceTransform, esbuild({ target: 'es2020' }), shimPlugin],
  external: ['leaflet'],
  onwarn(w) {
    if (!['UNRESOLVED_IMPORT', 'MISSING_GLOBAL_NAME', 'CIRCULAR_DEPENDENCY'].includes(w.code)) console.warn(w.message);
  },
});
