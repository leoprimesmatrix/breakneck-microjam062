// Bake the game into one self-contained dist/index.html, in the browser,
// because this machine has no node and therefore no vite.
//
// Strategy: transpile every module to CommonJS — TypeScript's own emit does
// all the import/export rewriting, including the one `export let` whose
// mutations have to stay visible across modules — with each import specifier
// pre-resolved to the module's absolute path. The bundle is then a registry of
// wrapped module bodies and a ten-line require shim, inlined into the shell
// index.html where the vite build's script tag used to be.
//
// Deliberately NOT the blob-URL trick the dev loader uses: a data-URL graph
// embeds every shared dependency once per importer and the size goes
// superlinear. CJS wrapping is O(modules), which is what a bundle is.

const TS_URL = 'https://esm.sh/typescript@5.7.2';
const TERSER_URL = 'https://esm.sh/terser@5.36.0';

let ts = null;

function splice(src, pos, url, path) {
  let start = pos;
  if (src[start] !== '"' && src[start] !== "'") start = pos - 1;
  const q = src[start];
  if (q !== '"' && q !== "'") {
    throw new Error(`no quote at ${pos} in ${path}: ${JSON.stringify(src.slice(pos - 2, pos + 20))}`);
  }
  const stop = src.indexOf(q, start + 1);
  if (stop < 0) throw new Error(`unterminated specifier at ${pos} in ${path}`);
  return src.slice(0, start) + JSON.stringify(url) + src.slice(stop + 1);
}

function resolve(from, spec) {
  const base = from.slice(0, from.lastIndexOf('/'));
  const parts = (base + '/' + spec).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  let path = '/' + out.join('/');
  if (!/\.[cm]?[jt]s$/.test(path)) path += '.ts';
  return path;
}

async function fetchSource(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} fetching ${path}`);
  return r.text();
}

/**
 * Crawl the graph and emit each module as a CJS function body keyed by path.
 * `dev` controls what import.meta.env folds to — a dev bake keeps the harness
 * hooks alive so the bundle itself can be driven and verified headlessly; the
 * shipping bake folds them away exactly as vite would.
 */
async function collect(entry, dev) {
  const done = new Map();

  async function build(path) {
    if (done.has(path)) return;
    done.set(path, null); // reserve: cycles are legal in CJS, recursion must stop

    let src = await fetchSource(path);
    src = src.replace(/import\.meta\.env\.DEV/g, String(dev))
             .replace(/import\.meta\.env\.PROD/g, String(!dev));

    const refs = ts.preProcessFile(src, true, true).importedFiles
      .filter((f) => f.fileName.startsWith('.'))
      .sort((a, b) => b.pos - a.pos);

    const deps = [];
    for (const ref of refs) {
      const dep = resolve(path, ref.fileName);
      // Type-only statements are erased by the transpile and need no body,
      // but the specifier is still rewritten so that if one ever *stops*
      // being type-only, the failure is a missing module, loudly, not a
      // silently wrong relative require.
      src = splice(src, ref.pos, dep, path);
      const stmtStart = src.lastIndexOf('import', ref.pos);
      const head = stmtStart >= 0 ? src.slice(stmtStart, ref.pos) : '';
      if (!/^import\s+type\b/.test(head)) deps.push(dep);
    }

    const js = ts.transpileModule(src, {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        useDefineForClassFields: true,
        esModuleInterop: false,
      },
    }).outputText;

    done.set(path, js);
    for (const dep of deps) await build(dep);
  }

  await build(entry);
  return done;
}

function assemble(mods, entry) {
  const parts = [];
  parts.push('(() => {');
  parts.push('"use strict";');
  parts.push('const __defs = Object.create(null);');
  for (const [path, js] of mods) {
    parts.push(`__defs[${JSON.stringify(path)}] = (exports, require, module) => {`);
    parts.push(js);
    parts.push('};');
  }
  parts.push('const __cache = Object.create(null);');
  parts.push('const __req = (p) => {');
  parts.push('  const hit = __cache[p];');
  parts.push('  if (hit) return hit.exports;');
  parts.push('  const m = (__cache[p] = { exports: {} });');
  parts.push('  __defs[p](m.exports, __req, m);');
  parts.push('  return m.exports;');
  parts.push('};');
  parts.push(`__req(${JSON.stringify(entry)});`);
  parts.push('})();');
  return parts.join('\n');
}

/**
 * Build dist/index.html and POST it into the repository's dist/.
 *
 * `minify` is on for a shipping bake and off for a dev one: mangled names make
 * a stack trace useless, and the dev bake exists to be driven and debugged.
 * Terser comes from esm.sh at bake time, the same trick as the compiler — the
 * whole toolchain is fetched rather than installed, which is the only kind
 * this machine can have.
 */
export async function bake({ dev = false, name = 'index.html', minify = !dev } = {}) {
  const t0 = performance.now();
  ts = await import(TS_URL);
  if (ts.default && !ts.preProcessFile) ts = ts.default;

  const entry = '/src/main.ts';
  const mods = await collect(entry, dev);
  let bundle = assemble(mods, entry);
  const raw = bundle.length;

  if (minify) {
    const terser = await import(TERSER_URL);
    const min = await (terser.minify ?? terser.default.minify)(bundle, {
      ecma: 2022,
      // The dead `if (false)` blocks the DEV fold leaves behind are exactly
      // what `dead_code` is for; two passes lets the constant folding that
      // exposes them and the elimination that removes them both happen.
      compress: { passes: 2, dead_code: true, unsafe_arrows: true },
      mangle: true,
      format: { comments: false },
    });
    if (!min.code) throw new Error('terser produced nothing');
    bundle = min.code;
  }

  // The shell is the real index.html, with the module tag swapped for the
  // inlined bundle. Everything else — splash, styles, meta — ships as-is.
  const shell = await fetchSource('/index.html');
  const tag = /<script type="module" src="\/src\/main\.ts"><\/script>/;
  if (!tag.test(shell)) throw new Error('index.html: module tag not found');
  const html = shell.replace(tag, () => `<script>\n${bundle}\n</script>`);

  // Chunked: spreading a few hundred kilobytes of bytes into one call blows
  // the argument-count limit long before it blows the heap.
  const bytes = new TextEncoder().encode(html);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  const r = await fetch(`/save?name=${encodeURIComponent(name)}&dir=dist`, {
    method: 'POST',
    body: 'data:text/html;base64,' + b64,
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);

  // A build is index.html *and* the ten mp3s beside it. Leaving them out made a
  // dist/ that boots and runs and is completely silent, which is the worst
  // possible shape for a bug to have: nothing throws and nothing logs. The
  // server does the copy — nineteen megabytes of audio does not want to make
  // the trip through base64 and a POST body to end up on the same disk.
  const a = await fetch('/assets', { method: 'POST' });
  if (!a.ok) throw new Error(`assets failed: ${a.status}`);
  const { copied } = await a.json();
  if (!copied) throw new Error('assets: nothing copied — dist/ would ship silent');

  const kb = Math.round(html.length / 1024);
  console.log(
    `[bake] ${mods.size} modules -> dist/${name} (${kb} kB, dev=${dev}) ` +
      `+ ${copied} asset(s) in ${Math.round(performance.now() - t0)}ms`,
  );
  return {
    modules: mods.size,
    bytes: html.length,
    kb,
    assets: copied,
    minified: minify,
    shrank: minify ? `${Math.round(raw / 1024)} kB -> ${Math.round(bundle.length / 1024)} kB` : null,
    name,
  };
}
