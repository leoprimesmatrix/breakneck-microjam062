// Compile the game's TypeScript in the browser, because this machine has no
// node, npm or bundler and therefore no vite.
//
// The real compiler is fetched from esm.sh and used for exactly what a bundler
// would do: strip the types, and rewrite each module's import specifiers to
// point at the compiled output of its dependencies. Compiled output becomes a
// blob: URL, so the browser's own module loader does the rest.
//
// The one subtlety is *where* the rewrite happens. Specifier positions come
// from `ts.preProcessFile`, which reports them against the TypeScript source —
// so the splice has to happen in that source, before `transpileModule` runs.
// Rewriting the emitted JS instead means hunting for positions that have moved.

const TS_URL = 'https://esm.sh/typescript@5.7.2';

let ts = null;

/**
 * Replace the specifier whose token starts at `pos` with `url`.
 *
 * `preProcessFile` reports `pos` at the opening quote of the string literal on
 * current TypeScript, but has reported it at the first character *inside* the
 * quote before. Rather than depend on which, find the quote at or beside `pos`
 * and scan to its partner — correct under either convention, and it fails loudly
 * instead of silently producing unparseable JavaScript.
 */
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

/** './engine/input' seen from '/src/main.ts' -> '/src/engine/input.ts' */
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

const sources = new Map();

async function fetchSource(path) {
  if (sources.has(path)) return sources.get(path);
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} fetching ${path}`);
  const text = await r.text();
  sources.set(path, text);
  return text;
}

/**
 * Post-order walk: a module is compiled only once every module it imports has a
 * blob URL, because those URLs are what get spliced into it.
 */
async function build(path, done, stack) {
  if (done.has(path)) return done.get(path);
  if (stack.includes(path)) {
    // Blob URLs cannot express a cycle; src/ is acyclic, so this means someone
    // just introduced one and should hear about it immediately.
    throw new Error(`import cycle: ${[...stack.slice(stack.indexOf(path)), path].join(' -> ')}`);
  }
  stack.push(path);

  let src = await fetchSource(path);

  // vite substitutes these at build time. The dev hooks in main.ts hang off
  // import.meta.env.DEV, and they are the entire reason this harness exists.
  src = src.replace(/import\.meta\.env\.DEV/g, 'true')
           .replace(/import\.meta\.env\.PROD/g, 'false');

  const refs = ts.preProcessFile(src, true, true).importedFiles
    .filter((f) => f.fileName.startsWith('.'))
    .sort((a, b) => b.pos - a.pos); // splice back-to-front: earlier positions stay valid

  for (const ref of refs) {
    // A whole-statement `import type { ... } from '...'` is erased entirely by
    // transpileModule under isolatedModules, so it is not a runtime edge and
    // must not count toward the cycle check — vite happily allows a type-only
    // cycle, and the game now contains one (sectors -> enemies, types only).
    // Inline `import { type X }` keeps its statement and stays a real edge.
    const stmtStart = src.lastIndexOf('import', ref.pos);
    const head = stmtStart >= 0 ? src.slice(stmtStart, ref.pos) : '';
    if (/^import\s+type\b/.test(head)) continue;
    const dep = resolve(path, ref.fileName);
    const url = await build(dep, done, stack);
    src = splice(src, ref.pos, url, path);
  }

  const js = ts.transpileModule(src, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      useDefineForClassFields: true,
      isolatedModules: true,
    },
  }).outputText;

  const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  stack.pop();
  done.set(path, url);
  return url;
}

export async function load(entry = '/src/main.ts') {
  const t0 = performance.now();
  ts = await import(TS_URL);
  if (ts.default && !ts.preProcessFile) ts = ts.default;

  const done = new Map();
  const url = await build(entry, done, []);
  const mod = await import(url);
  console.log(`[tsload] ${done.size} modules in ${Math.round(performance.now() - t0)}ms`);
  return mod;
}
