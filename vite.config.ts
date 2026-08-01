import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev-only capture sink. The page POSTs a data URL to /__shot and it lands in
 * shots/ on disk, so frames can be inspected without a visible browser pane.
 * Also how the itch.io cover art and GIF frames get produced later.
 */
function shotSink(): Plugin {
  return {
    name: 'shot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body) as { name: string; data: string };
            const safe = name.replace(/[^a-z0-9._-]/gi, '_');
            const b64 = data.slice(data.indexOf(',') + 1);
            const dir = resolve(process.cwd(), 'shots');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, safe), Buffer.from(b64, 'base64'));
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

/**
 * Collapse the whole build into one self-contained index.html.
 *
 * itch.io unzips the upload and serves it from a nested path inside an iframe,
 * and a zip produced on Windows can carry backslash separators that turn
 * `assets/x.js` into a literal filename — at which point the page loads and the
 * script 404s. One file with the JS inlined removes that entire failure mode,
 * and it is a single request instead of two.
 */
function singleFile(): Plugin {
  return {
    name: 'single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (f): f is typeof f & { source: string | Uint8Array } =>
          f.type === 'asset' && f.fileName.endsWith('.html'),
      );
      const entry = Object.values(bundle).find(
        (f): f is typeof f & { code: string } => f.type === 'chunk' && f.isEntry,
      );
      if (!html || !entry) return;

      // `</script>` inside the payload would close the tag early.
      const code = entry.code.replace(/<\/script>/gi, '<\\/script>');

      html.source = html.source
        .toString()
        .replace(/<script[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/gi, '')
        .replace('</body>', `  <script type="module">${code}</script>\n  </body>`);

      delete bundle[entry.fileName];
    },
  };
}

// itch.io serves the game from a nested path inside an iframe, so every asset
// reference has to be relative rather than root-absolute.
export default defineConfig({
  base: './',
  plugins: [shotSink(), singleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 1024 * 1024, // inline everything; one file loads fastest in the itch iframe
    cssCodeSplit: false,
  },
});
