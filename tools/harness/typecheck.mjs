// A real type check, in the browser, for a machine with no node.
//
//   await CHECK()   -> [{file, line, col, code, message}, ...]
//
// `tsload` and `bake` both use `ts.transpileModule`, which erases types without
// ever looking at them: it is a syntax-directed strip, so a call with the wrong
// argument count, a property that does not exist and an unused import all
// compile perfectly and ship. `package.json` knows this — its build is
// `tsc --noEmit && vite build` — and that first half has never once run on this
// machine, because there is no node here to run it with.
//
// So it runs here instead, out of the same compiler the loader already fetches.
// This is the third thing in tools/harness/ built on the observation that the
// browser is a JavaScript runtime and the only missing piece was ever the file
// system: the loader compiles, the bundler links, and this one checks.
//
// Reads are synchronous XMLHttpRequest, deliberately. `ts.createProgram` is a
// synchronous API that pulls files as it discovers imports, and the alternative
// is pre-walking the module graph by hand to prefetch everything — which is
// exactly the job being delegated to the compiler in the first place. Blocking
// the main thread of a dev page for a second is not a cost worth engineering
// around.

const TS_URL = 'https://esm.sh/typescript@5.7.2';
/** Where lib.*.d.ts come from. esm.sh serves modules; this needs raw files. */
const LIB_BASE = 'https://unpkg.com/typescript@5.7.2/lib/';

let ts = null;

/**
 * Read cache, and the one thing about it that matters.
 *
 * `lib.*.d.ts` is a few megabytes fetched cross-origin, and re-reading it per
 * run is the entire difference between a 2.7 s check and a 0.9 s one. Project
 * sources are the opposite: this module outlives any single run, so anything
 * kept here is a file the next check will *not* look at again. Caching those
 * once cost exactly what it sounds like — a bake gated on a type check that
 * passed against the source as it was several edits ago, and wrote a build from
 * code it had never read.
 *
 * So the lib files persist and everything else is dropped at the top of a run.
 */
const cache = new Map();
function freshen() {
  for (const key of [...cache.keys()]) {
    if (!key.startsWith(LIB_BASE)) cache.delete(key);
  }
}

function getSync(url) {
  if (cache.has(url)) return cache.get(url);
  let out = null;
  try {
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send();
    if (x.status >= 200 && x.status < 300) out = x.responseText;
  } catch {
    out = null;
  }
  cache.set(url, out);
  return out;
}

/**
 * `vite-env.d.ts` is one line pulling in `vite/client`, which lives in a
 * node_modules that does not exist here. The only thing the game actually uses
 * from it is `import.meta.env.DEV` — the flag the dev-only blocks fold on — so
 * that gets declared directly rather than dragging in a package to get it.
 */
const SHIM = '/__harness/env.d.ts';
const VIRTUAL = new Map([
  [
    SHIM,
    `interface ImportMetaEnv { readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string; readonly BASE_URL: string; }
     interface ImportMeta { readonly env: ImportMetaEnv; }`,
  ],
]);

/** A compiler file name to something fetchable. */
function urlFor(name) {
  const base = name.replace(/^\.?\//, '');
  if (/^lib\..*\.d\.ts$/.test(base)) return LIB_BASE + base;
  return name.startsWith('/') ? name : '/' + name;
}

function readFile(name) {
  if (VIRTUAL.has(name)) return VIRTUAL.get(name);
  const text = getSync(urlFor(name));
  return text === null ? undefined : text;
}

/**
 * Run the check. Options come from the repository's own tsconfig.json, so this
 * agrees with `npm run build` on another machine rather than inventing a second
 * standard — including `strict`, `noUnusedLocals` and `noUnusedParameters`,
 * which is what makes this a dead-code report as much as a type report.
 */
export async function check({ entry = '/src/main.ts', quiet = false } = {}) {
  const t0 = performance.now();
  freshen();
  ts = await import(TS_URL);
  if (ts.default && !ts.createProgram) ts = ts.default;

  const raw = getSync('/tsconfig.json');
  if (!raw) throw new Error('tsconfig.json not readable');
  const parsed = ts.parseConfigFileTextToJson('/tsconfig.json', raw);
  if (parsed.error) throw new Error('tsconfig.json did not parse');

  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      ...parsed.config.compilerOptions,
      // No node_modules to look in, and nothing in src/ wants an @types package.
      types: [],
      noEmit: true,
    },
    '/',
  );
  if (errors.length && !quiet) console.warn('[check] tsconfig:', errors.map((e) => e.messageText));

  const host = {
    getSourceFile(name, langVersion) {
      const text = readFile(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, langVersion, true);
    },
    writeFile() {},
    getDefaultLibFileName: (o) => ts.getDefaultLibFileName(o),
    getDefaultLibLocation: () => '',
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => VIRTUAL.has(name) || readFile(name) !== undefined,
    readFile,
    // Deliberately absent: `resolveModuleNames`. Letting the compiler resolve
    // through fileExists is the whole point — it is what makes this check the
    // same program the bundler builds, rather than a second opinion about it.
  };

  const program = ts.createProgram([SHIM, entry], options, host);
  const diags = ts.getPreEmitDiagnostics(program);

  const out = diags.map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (!d.file) return { file: '(global)', line: 0, col: 0, code: d.code, message: msg };
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return {
      file: d.file.fileName,
      line: line + 1,
      col: character + 1,
      code: d.code,
      message: msg,
    };
  });

  if (!quiet) {
    const files = program.getSourceFiles().filter((f) => f.fileName.startsWith('/src/')).length;
    console.log(
      `[check] ${files} source files, ${out.length} diagnostic(s) in ${Math.round(performance.now() - t0)}ms`,
    );
    for (const d of out) console.log(`  ${d.file}:${d.line}:${d.col}  TS${d.code}  ${d.message}`);
  }
  return out;
}
