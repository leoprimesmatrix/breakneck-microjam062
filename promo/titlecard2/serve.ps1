# Static server + file sink for the titlecard v2 render pipeline.
#
# The original pipeline leaned on `npm run dev` for two things only: serving
# modules to a browser and catching the frames it POSTed back. Neither needs
# node — this is both halves in ~100 lines of PowerShell, so the sequence can
# be re-rendered on a machine with nothing installed on it.
#
#   powershell -ExecutionPolicy Bypass -File promo/titlecard2/serve.ps1
#
# GET  /<path>                   any file under the repo root (no-store, so
#                                edits to the sequence reload for real)
# POST /save?name=x.mp4          raw body -> promo/<x.mp4>   (rendered output)
# POST /save?name=x.png&dir=tmp  raw body -> <repo>/promo/titlecard2/tmp/<x.png>
#                                (preview stills; gitignored)
# GET  /ping                     liveness probe

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$promo = Join-Path $root 'promo'
$tmp = Join-Path $root 'promo\titlecard2\tmp'
New-Item -ItemType Directory -Force $tmp | Out-Null

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.gif'  = 'image/gif'
  '.mp4'  = 'video/mp4'
  '.svg'  = 'image/svg+xml'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8788/')
$listener.Start()
Write-Output "titlecard2 server on http://localhost:8788/ root=$root"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

    if ($req.HttpMethod -eq 'GET' -and $path -eq '/ping') {
      $bytes = [Text.Encoding]::UTF8.GetBytes('ok')
      $res.StatusCode = 200
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    if ($req.HttpMethod -eq 'POST' -and $path -eq '/save') {
      $name = $req.QueryString['name']
      $dir = $req.QueryString['dir']
      if (-not $name -or $name -notmatch '^[a-zA-Z0-9._-]+$') {
        $res.StatusCode = 400
        $res.Close()
        continue
      }
      $target = $promo
      if ($dir -eq 'tmp') { $target = $tmp }
      $ms = New-Object System.IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes((Join-Path $target $name), $ms.ToArray())
      Write-Output ("saved {0}\{1} ({2} bytes)" -f $target, $name, $ms.Length)
      $bytes = [Text.Encoding]::UTF8.GetBytes('saved')
      $res.StatusCode = 200
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    if ($req.HttpMethod -eq 'GET') {
      if ($path -eq '/') { $path = '/promo/titlecard2/run.html' }
      $rel = $path.TrimStart('/') -replace '/', '\'
      $file = Join-Path $root $rel
      $full = [IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        $res.StatusCode = 404
        $res.Close()
        continue
      }
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.StatusCode = 200
      $res.ContentType = $type
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $res.StatusCode = 405
    $res.Close()
  } catch {
    Write-Output ("request error: {0}" -f $_.Exception.Message)
  }
}
