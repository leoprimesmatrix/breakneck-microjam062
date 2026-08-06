# A dev server and a build, for a machine with no node.
#
#   powershell -ExecutionPolicy Bypass -File tools/serve.ps1
#   -> http://localhost:8790/
#
# `vite` does two things this game actually needs: serve modules to a browser,
# and collapse them into one file. Neither requires node. This is the first
# half — a static server over the repository — and `tools/harness/` is the
# second: the TypeScript compiler, fetched from esm.sh and driven in the page.
#
#   /              the dev page: real src/, compiled in the browser
#   /dist/*        baked builds (see BAKE below)
#   everything else   the repository, with a public/ fallback, because vite
#                     serves public/ at the root and the game asks for music/
#
# In the console:
#   await BAKE()                       -> dist/index.html, minified, shippable
#   await BAKE({dev:true, minify:false, name:'index-dev.html'})
#
# POST /save?name=x            writes a base64 body to tools/tmp/ (screenshots)
# POST /save?name=x&dir=dist   writes it to dist/ (the bake's only sink)

param(
  [int]$Port = 8790
)

$ErrorActionPreference = 'Stop'
$Repo    = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Harness = Join-Path $PSScriptRoot 'harness'
$Tmp     = Join-Path $PSScriptRoot 'tmp'
if (-not (Test-Path $Tmp)) { New-Item -ItemType Directory -Force -Path $Tmp | Out-Null }

$MIME = @{
  '.html' = 'text/html; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  # Deliberate: the loader fetches .ts as source text. The browser must never be
  # handed one as a module — it cannot parse types and the error is inscrutable.
  '.ts'   = 'text/plain; charset=utf-8'
  '.mp3'  = 'audio/mpeg'
  '.wav'  = 'audio/wav'
  '.ogg'  = 'audio/ogg'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

function Resolve-Path-Safe([string]$root, [string]$rel) {
  $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $full
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "AFTERBURN on http://localhost:$Port/"
Write-Host "  console:  await BAKE()   ->  dist/index.html"
Write-Host "  audio is muted by default; append ?sound to any URL to hear it"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

      if ($req.HttpMethod -eq 'POST' -and $path -eq '/save') {
        $name = $req.QueryString['name']
        if (-not $name) { $name = 'frame' }
        $name = ($name -replace '[^A-Za-z0-9._-]', '_')
        $reader = New-Object IO.StreamReader($req.InputStream, $req.ContentEncoding)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $b64 = $body -replace '^data:[^,]*,', ''
        $target = $Tmp
        if ($req.QueryString['dir'] -eq 'dist') {
          $target = Join-Path $Repo 'dist'
          if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
        }
        [IO.File]::WriteAllBytes((Join-Path $target $name), [Convert]::FromBase64String($b64))
        Write-Host ("saved {0}\{1}" -f $target, $name)
        $res.StatusCode = 200
        $res.ContentType = 'text/plain'
        $out = [Text.Encoding]::UTF8.GetBytes("ok $name")
        $res.OutputStream.Write($out, 0, $out.Length)
        $res.Close()
        continue
      }

      $full = $null
      # Only the bare root is the dev page. `/index.html` has to reach the
      # repository's real shell, because that is what the bundler wraps.
      if ($path -eq '/') {
        $full = Join-Path $Harness 'index.html'
      } elseif ($path.StartsWith('/harness/')) {
        $full = Resolve-Path-Safe $Harness $path.Substring(9)
      } else {
        $rel = $path.TrimStart('/')
        $full = Resolve-Path-Safe $Repo $rel
        if ($full -and -not (Test-Path $full -PathType Leaf)) {
          $alt = Resolve-Path-Safe $Repo (Join-Path 'public' $rel)
          if ($alt -and (Test-Path $alt -PathType Leaf)) { $full = $alt }
        }
        # A build asks for `music/x.mp3` relative to itself, which is right on
        # itch.io where index.html sits beside music/ — and wrong here, where it
        # is served out of /dist/ and resolves to /dist/music/x.mp3. Without
        # this every audition of a build 404s its whole soundtrack and looks
        # like a bug in the bundler.
        if ($full -and -not (Test-Path $full -PathType Leaf) -and $rel -like 'dist/*') {
          $alt = Resolve-Path-Safe $Repo (Join-Path 'public' $rel.Substring(5))
          if ($alt -and (Test-Path $alt -PathType Leaf)) { $full = $alt }
        }
      }

      if (-not $full) {
        $res.StatusCode = 403
      } elseif (-not (Test-Path $full -PathType Leaf)) {
        $res.StatusCode = 404
        Write-Host "404 $path"
      } else {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()

        # A baked build is the real game and starts its soundtrack the moment
        # you touch it. That is correct on itch.io and wrong on a dev machine
        # where builds get opened by tooling as often as by a person, so the
        # *response* gets a silencer while the bytes on disk stay exactly
        # shippable. `?sound` opts in, same as the dev page.
        if ($ext -eq '.html' -and $full.StartsWith((Join-Path $Repo 'dist'), [StringComparison]::OrdinalIgnoreCase)) {
          if ($req.Url.Query -notmatch 'sound') {
            $hush = @'
<script>
(() => {
  // Belt: every AudioContext this page builds gets its destination cut.
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const patch = function (...a) {
      const ctx = new AC(...a);
      try { ctx.suspend(); } catch (e) {}
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      Object.defineProperty(ctx, 'destination', { get: () => gain });
      return ctx;
    };
    patch.prototype = AC.prototype;
    window.AudioContext = window.webkitAudioContext = patch;
  }
  // Braces: the soundtrack decks are bare `new Audio()`, never in the DOM.
  const A = window.Audio;
  window.Audio = function (...a) {
    const el = new A(...a);
    el.muted = true;
    const play = el.play.bind(el);
    el.play = () => { el.muted = true; el.volume = 0; return play(); };
    return el;
  };
  const tag = document.createElement('div');
  tag.textContent = 'MUTED - add ?sound to hear it';
  tag.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:9;pointer-events:none;' +
    'font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#7e92be;opacity:.55';
  addEventListener('DOMContentLoaded', () => document.body.appendChild(tag));
})();
</script>
'@
            $text = [Text.Encoding]::UTF8.GetString($bytes)
            # Before everything, so it is installed prior to any game code.
            $text = $text -replace '(?i)<head>', ("<head>" + $hush)
            $bytes = [Text.Encoding]::UTF8.GetBytes($text)
          }
        }
        $res.ContentType = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
        $res.Headers['Accept-Ranges'] = 'bytes'
        $res.Headers['Cache-Control'] = 'no-store'

        # The soundtrack is streamed with <audio>, and browsers probe it with a
        # Range request before they will play anything.
        $range = $req.Headers['Range']
        if ($range -and $range -match 'bytes=(\d*)-(\d*)') {
          $from = if ($matches[1] -ne '') { [int64]$matches[1] } else { 0 }
          $to   = if ($matches[2] -ne '') { [int64]$matches[2] } else { $bytes.Length - 1 }
          if ($to -ge $bytes.Length) { $to = $bytes.Length - 1 }
          if ($from -le $to) {
            $len = [int]($to - $from + 1)
            $res.StatusCode = 206
            $res.Headers['Content-Range'] = "bytes $from-$to/$($bytes.Length)"
            $res.ContentLength64 = $len
            $res.OutputStream.Write($bytes, [int]$from, $len)
            $res.OutputStream.Flush()
            $res.Close()
            continue
          }
        }

        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      $res.StatusCode = 500
      Write-Host "500 $($req.Url.AbsolutePath): $_"
    }
    try { $res.OutputStream.Flush(); $res.Close() } catch {}
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
