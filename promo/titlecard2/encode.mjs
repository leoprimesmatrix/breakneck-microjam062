/**
 * In-browser encoding for the titlecard v2 renders — no ffmpeg on the machine,
 * so the browser does the whole job: WebCodecs H.264 into an mp4 via
 * `mp4-muxer`, and a palette-quantised GIF via `gifenc`. Both libraries load
 * from esm.sh at render time; nothing here ships in the game bundle.
 *
 * The mp4 is 1920x1080@60, ~12 Mbps. The GIF is 560x315 (matching v1's
 * `title-anim.gif`) and steps its frame stride / palette down until it fits
 * under itch.io's 3 MB image ceiling.
 */

async function loadMuxer() {
  const m = await import('https://esm.sh/mp4-muxer@5.2.1');
  return m.default?.Muxer ? m.default : m;
}

async function loadGifenc() {
  const candidates = [
    'https://esm.sh/gifenc@1.0.3',
    'https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js',
  ];
  for (const url of candidates) {
    try {
      const m = await import(url);
      const g = m.GIFEncoder ? m : m.default && m.default.GIFEncoder ? m.default : null;
      if (g && g.quantize && g.applyPalette) return g;
    } catch {
      /* next */
    }
  }
  throw new Error('gifenc unavailable from CDN');
}

async function post(name, bytes) {
  const res = await fetch(`/save?name=${name}`, { method: 'POST', body: bytes });
  if (!res.ok) throw new Error(`save ${name}: HTTP ${res.status}`);
}

/**
 * Render every frame of `seq` once, feeding the mp4 encoder at full size and
 * collecting downscaled RGBA for the GIF pass. One pass over the timeline —
 * the GIF must not cost a second full render.
 */
export async function encodeVariant(seq, baseName, opts = {}) {
  const total = opts.maxFrames ? Math.min(opts.maxFrames, seq.marks.frames) : seq.marks.frames;
  const doGif = opts.gif !== false;
  const doMp4 = opts.mp4 !== false;
  const P = (window.__prog = {
    variant: seq.VARIANT, base: baseName, i: 0, total, phase: 'mp4', mp4Bytes: 0, gifBytes: 0, error: null,
  });

  let muxer = null;
  let target = null;
  let encoder = null;
  if (doMp4) {
    const { Muxer, ArrayBufferTarget } = await loadMuxer();
    target = new ArrayBufferTarget();
    muxer = new Muxer({
      target,
      video: { codec: 'avc', width: seq.W, height: seq.H, frameRate: seq.FPS },
      fastStart: 'in-memory',
    });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { P.error = String(e); },
    });
    encoder.configure({
      codec: 'avc1.640028',
      width: seq.W,
      height: seq.H,
      // Long pieces (the trailer) pass a lower bitrate so the repo does not
      // carry hundreds of megabytes of dark sky.
      bitrate: opts.bitrate ?? 12_000_000,
      framerate: seq.FPS,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });
  }

  // GIF collection: stride 3 (20fps, exact 5cs delays). Kept as raw RGBA and
  // quantised after the render pass, so the fit-under-3MB retries are cheap.
  const GW = 560;
  const GH = 315;
  const gifCanvas = document.createElement('canvas');
  gifCanvas.width = GW;
  gifCanvas.height = GH;
  const gifCtx = gifCanvas.getContext('2d', { willReadFrequently: true });
  const gifFrames = [];
  const GIF_STRIDE = opts.gifStride ?? 3;

  const cv = seq.canvas();
  const g = cv.getContext('2d');

  for (let i = 0; i < total; i++) {
    seq.frame(g, i / seq.FPS);
    if (doMp4) {
      const vf = new VideoFrame(cv, { timestamp: (i * 1e6) / seq.FPS, duration: 1e6 / seq.FPS });
      encoder.encode(vf, { keyFrame: i % 120 === 0 });
      vf.close();
      if (encoder.encodeQueueSize > 8) {
        await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
      }
    }
    if (doGif && i % GIF_STRIDE === 0) {
      gifCtx.drawImage(cv, 0, 0, GW, GH);
      gifFrames.push(gifCtx.getImageData(0, 0, GW, GH).data.slice());
    }
    P.i = i + 1;
    if (i % 4 === 0) await new Promise((r) => setTimeout(r));
  }

  if (doMp4) {
    await encoder.flush();
    encoder.close();
    muxer.finalize();
    const mp4 = new Uint8Array(target.buffer);
    P.mp4Bytes = mp4.byteLength;
    await post(`${baseName}.mp4`, mp4);
  }

  if (!doGif) {
    P.phase = 'done';
    return { mp4: P.mp4Bytes, gif: 0 };
  }

  P.phase = 'gif';
  const G = await loadGifenc();
  const CAP = 2_950_000; // stay under itch's 3 MB with headroom

  // A global palette from frames sampled across the whole run, so the loop
  // doesn't shimmer the way per-frame palettes do.
  const buildPalette = (colors) => {
    const step = Math.max(1, Math.floor(gifFrames.length / 10));
    let n = 0;
    for (let i = 0; i < gifFrames.length; i += step) n += gifFrames[i].length;
    const sample = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < gifFrames.length; i += step) {
      sample.set(gifFrames[i], o);
      o += gifFrames[i].length;
    }
    return G.quantize(sample, colors, { format: 'rgb565' });
  };

  /**
   * Inter-frame differencing: most of every frame is the same dark room, so
   * pixels that barely changed since what is on screen become a transparent
   * index over the previous frame (disposal: keep). That head-room is what
   * lets the GIF hold 20fps under the cap. `tol` absorbs the film grain —
   * without it the grain re-paints every pixel of black every frame.
   */
  // `tol` just clears the film grain (±3-4 on near-black); any higher and the
  // moving camera leaves stale-pixel smears across the background. `refresh`
  // writes a full frame every so often, so what staleness does slip through
  // never survives longer than most of a second.
  // The ladder has to reach far enough for the *longest* variant, not the one
  // it was tuned on. It used to stop at the fourth rung, which lands a 543
  // frame sequence at 2.8 MB and a 753 frame one at 3.3 MB — over the cap, and
  // shipped anyway, because falling off the end of the ladder was silent.
  // `refresh` counts frames *between* full ones, so raising it is the cheapest
  // remaining win once the palette is already small.
  const attempts = opts.attempts ?? [
    { skip: 1, colors: 255, delay: 5, tol: 6, refresh: 16 },
    { skip: 1, colors: 199, delay: 5, tol: 6, refresh: 16 },
    { skip: 1, colors: 199, delay: 5, tol: 8, refresh: 12 },
    { skip: 2, colors: 199, delay: 10, tol: 6, refresh: 8 },
    { skip: 2, colors: 160, delay: 10, tol: 8, refresh: 16 },
    { skip: 2, colors: 128, delay: 10, tol: 10, refresh: 24 },
    { skip: 3, colors: 128, delay: 15, tol: 12, refresh: 30 },
  ];
  const TIDX = 255;
  let bytes = null;
  let used = null;
  for (const at of attempts) {
    // Pad to a full table so index 255 exists for transparency. The pad
    // colour is off-black but distinct from true black even in rgb565, so
    // applyPalette never picks it for a real pixel by accident.
    const palette = buildPalette(at.colors);
    while (palette.length < 256) palette.push([8, 4, 8]);
    const gif = G.GIFEncoder();
    const shown = new Uint8Array(gifFrames[0].length); // rgba actually on screen
    let first = true;
    let fi = 0;
    for (let i = 0; i < gifFrames.length; i += at.skip, fi++) {
      const rgba = gifFrames[i];
      const index = G.applyPalette(rgba, palette, 'rgb565');
      const full = first || fi % at.refresh === 0;
      if (full) {
        shown.set(rgba);
      } else {
        for (let p = 0, q = 0; p < index.length; p++, q += 4) {
          const d =
            Math.abs(rgba[q] - shown[q]) +
            Math.abs(rgba[q + 1] - shown[q + 1]) +
            Math.abs(rgba[q + 2] - shown[q + 2]);
          if (d <= at.tol) {
            index[p] = TIDX;
          } else {
            shown[q] = rgba[q];
            shown[q + 1] = rgba[q + 1];
            shown[q + 2] = rgba[q + 2];
          }
        }
      }
      gif.writeFrame(index, GW, GH, {
        palette: first ? palette : undefined,
        delay: at.delay * 10,
        transparent: !full,
        transparentIndex: TIDX,
        dispose: 1,
      });
      first = false;
      if (i % 20 === 0) await new Promise((r) => setTimeout(r));
    }
    gif.finish();
    bytes = gif.bytes();
    used = at;
    P.gifBytes = bytes.byteLength;
    if (bytes.byteLength <= CAP) break;
  }
  // Running out of ladder is a real outcome and used to be an invisible one:
  // the file still posted, still looked fine locally, and only failed at the
  // upload. Say so, and hand the caller a flag it can check.
  const overCap = bytes.byteLength > CAP;
  if (overCap) {
    console.warn(
      `[encode] ${baseName}.gif is ${(bytes.byteLength / 1e6).toFixed(2)} MB, over the ` +
        `${(CAP / 1e6).toFixed(2)} MB cap — the ladder ran out. Pass a lower \`attempts\`.`,
    );
  }
  await post(`${baseName}.gif`, bytes);
  P.phase = 'done';
  return { mp4: P.mp4Bytes, gif: P.gifBytes, gifAttempt: used, overCap };
}
