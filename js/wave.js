/** Stacked lanes: waveform · routing · log-mel · word · phone.
 *  Lane labels sit in a left gutter (outside the data area). Pink bands = frames
 *  dropped at the current keep-rate. Click anywhere to seek.
 */
(function (global) {
  const DROP = "rgba(200,120,120,0.42)";
  const WAVE_LINE = "#2a2825";
  const WAVE_MID = "#e6e0d8";
  const ROUTE = "#264653";
  const LANE_LINE = "#e6e0d8";
  const WORD_LINE = "#cfc7bb";
  const WORD_TXT = "#3a3530";
  const PLAYHEAD = "#8b3a3a";
  const LABEL = "#8a8278";
  // phone voicing classes: 0 silence · 1 unvoiced · 2 voiced
  const CLASS_FILL = ["#e9ebed", "#f4d3c6", "#cfe8e2"];
  const CLASS_TXT = ["#9aa0a6", "#c0562f", "#1f6f63"];
  const CLASS_NAME = ["silence", "unvoiced", "voiced"];

  const LANES = [
    ["waveform", 70],
    ["routing", 54],
    ["log-mel", 84],
    ["word", 22],
    ["phone", 22],
  ];
  const GAP = 6;
  const GUTTER = 62;   // left label column (outside plot)
  const PAD_T = 24;
  const PAD_B = 30;    // room for the voicing legend

  function layout(canvas) {
    const cssW = canvas.clientWidth || 900;
    const pad = { l: GUTTER, r: 12, t: PAD_T, b: PAD_B };
    const y = {};
    let cur = pad.t;
    for (const [name, h] of LANES) {
      y[name] = { y0: cur, y1: cur + h, h };
      cur += h + GAP;
    }
    const cssH = cur - GAP + pad.b;
    return { cssW, cssH, pad, y, W: cssW - pad.l - pad.r };
  }

  function fitFont(ctx, text, maxW, base, min) {
    let fs = base;
    ctx.font = `${fs}px system-ui, sans-serif`;
    while (fs > min && ctx.measureText(text).width > maxW * 0.92) {
      fs -= 0.5;
      ctx.font = `${fs}px system-ui, sans-serif`;
    }
    return ctx.measureText(text).width <= maxW * 0.95 ? fs : null;
  }

  const MAGMA = [
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
    [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191],
  ];
  function magma(t) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (MAGMA.length - 1);
    const i = Math.floor(x), f = x - i;
    const a = MAGMA[i], b = MAGMA[Math.min(i + 1, MAGMA.length - 1)];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function melCanvas(masks) {
    if (masks._melCanvas) return masks._melCanvas;
    const mel = masks.mel;
    if (!mel || !mel.b64) return null;
    const bin = atob(mel.b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const M = mel.mels, F = mel.frames;
    const off = document.createElement("canvas");
    off.width = F; off.height = M;
    const octx = off.getContext("2d");
    const img = octx.createImageData(F, M);
    for (let row = 0; row < M; row++) {
      const yPix = M - 1 - row;
      for (let col = 0; col < F; col++) {
        const v = data[row * F + col] / 255;
        const [r, g, b] = magma(v);
        const p = (yPix * F + col) * 4;
        img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    masks._melCanvas = off;
    return off;
  }

  function gutterLabel(ctx, text, xRight, yMid) {
    ctx.fillStyle = LABEL;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(text, xRight, yMid);
  }

  function draw(canvas, masks, rateKey, playheadSec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = layout(canvas);
    canvas.style.height = L.cssH + "px";
    canvas.width = Math.round(L.cssW * dpr);
    canvas.height = Math.round(L.cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.cssW, L.cssH);

    const { pad, W, cssW, cssH, y } = L;
    const dur = masks.duration, hop = masks.hop, sr = masks.sr;
    const meta = masks.rates[rateKey];
    if (!meta) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    const xAt = (t) => pad.l + (t / dur) * W;
    const frameDur = hop / sr;
    const analysisTop = y.waveform.y0, analysisBot = y["log-mel"].y1;

    // dropped-frame bands over waveform+routing+mel
    ctx.fillStyle = DROP;
    for (const [a, b] of meta.drop_runs) {
      const x0 = xAt(a * frameDur), x1 = xAt(b * frameDur);
      ctx.fillRect(x0, analysisTop, Math.max(1, x1 - x0), analysisBot - analysisTop);
    }

    // ---- gutter labels (outside the plot) ----
    const gx = pad.l - 8;
    for (const [name, ] of LANES) gutterLabel(ctx, name, gx, (y[name].y0 + y[name].y1) / 2);

    // ---- lane 1: waveform (dense min/max envelope, same look as the static stack) ----
    const wMid = y.waveform.y0 + y.waveform.h / 2;
    const env = masks.wave_env && masks.wave_env.lo ? masks.wave_env : null;
    ctx.strokeStyle = WAVE_MID; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, wMid); ctx.lineTo(pad.l + W, wMid); ctx.stroke();
    if (env) {
      let peak = 1e-6;
      for (const v of env.hi) if (v > peak) peak = v;
      for (const v of env.lo) if (-v > peak) peak = -v;
      const wScale = (y.waveform.h * 0.46) / peak;
      const bins = env.lo.length;
      ctx.strokeStyle = WAVE_LINE; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let b = 0; b < bins; b++) {
        const x = pad.l + (b / (bins - 1)) * W;
        ctx.moveTo(x, wMid - env.hi[b] * wScale);
        ctx.lineTo(x, wMid - env.lo[b] * wScale);
      }
      ctx.stroke();
    } else {
      const wave = Array.isArray(masks.wave) ? masks.wave : [];
      let peak = 1e-6;
      for (const v of wave) peak = Math.max(peak, Math.abs(v));
      const wScale = (y.waveform.h * 0.46) / peak;
      ctx.strokeStyle = WAVE_LINE; ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const x = pad.l + (i / Math.max(1, wave.length - 1)) * W;
        const yy = wMid - wave[i] * wScale;
        i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // ---- lane 2: routing score (z) ----
    const rt = masks.routing || [];
    if (rt.length) {
      let lo = Infinity, hi = -Infinity;
      for (const v of rt) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const rng = (hi - lo) || 1;
      const ry = (v) => y.routing.y1 - ((v - lo) / rng) * (y.routing.h - 4) - 2;
      if (lo < 0 && hi > 0) {
        ctx.strokeStyle = LANE_LINE; ctx.beginPath();
        ctx.moveTo(pad.l, ry(0)); ctx.lineTo(pad.l + W, ry(0)); ctx.stroke();
      }
      ctx.strokeStyle = ROUTE; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let i = 0; i < rt.length; i++) {
        const x = pad.l + (i / Math.max(1, rt.length - 1)) * W;
        i === 0 ? ctx.moveTo(x, ry(rt[i])) : ctx.lineTo(x, ry(rt[i]));
      }
      ctx.stroke();
    }

    // ---- lane 3: log-mel ----
    const mc = melCanvas(masks);
    if (mc) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mc, pad.l, y["log-mel"].y0, W, y["log-mel"].h);
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      for (const [a, b] of meta.drop_runs) {
        const x0 = xAt(a * frameDur), x1 = xAt(b * frameDur);
        ctx.fillRect(x0, y["log-mel"].y0, Math.max(1, x1 - x0), y["log-mel"].h);
      }
    }

    // ---- lane 4: word ----
    drawIntervalLane(ctx, masks.words || [], y.word, xAt, pad, W,
      (it) => it.w, () => WORD_LINE, () => "#fdfbf7", () => WORD_TXT);

    // ---- lane 5: phone (colored by voicing) ----
    drawIntervalLane(ctx, (masks.phones || []), y.phone, xAt, pad, W,
      (it) => (it.c === 0 ? "" : it.p),
      () => "#ffffff",
      (it) => CLASS_FILL[it.c || 0],
      (it) => CLASS_TXT[it.c || 0]);

    // ---- voicing legend (bottom) ----
    let lx = pad.l;
    const ly = cssH - 14;
    ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
    for (let ci = 0; ci < 3; ci++) {
      ctx.fillStyle = CLASS_FILL[ci];
      ctx.strokeStyle = "#d8d2c8"; ctx.lineWidth = 1;
      ctx.fillRect(lx, ly - 6, 14, 12); ctx.strokeRect(lx, ly - 6, 14, 12);
      ctx.fillStyle = CLASS_TXT[ci]; ctx.textAlign = "left";
      ctx.fillText(CLASS_NAME[ci], lx + 19, ly);
      lx += 22 + ctx.measureText(CLASS_NAME[ci]).width + 16;
    }

    // playhead
    if (playheadSec != null && dur > 0) {
      const t = Math.max(0, Math.min(dur, playheadSec));
      const x = xAt(t);
      ctx.strokeStyle = PLAYHEAD; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t - 2); ctx.lineTo(x, y.phone.y1); ctx.stroke();
      ctx.fillStyle = PLAYHEAD; ctx.beginPath();
      ctx.moveTo(x, pad.t - 2); ctx.lineTo(x - 4, pad.t - 8); ctx.lineTo(x + 4, pad.t - 8);
      ctx.closePath(); ctx.fill();
    }

    // title (top-left, above gutter)
    ctx.fillStyle = "#6b6560"; ctx.font = "12px ui-monospace, monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const title = rateKey === "auto"
      ? `auto  (β≈${meta.target.toFixed(2)})` : `keep ${meta.target.toFixed(2)}`;
    ctx.fillText(title, 4, 14);

    // readouts (top-right)
    const boxW = 210, boxH = 32, bx = cssW - pad.r - boxW, by = 2;
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "#c44"; ctx.lineWidth = 1;
    ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH);
    ctx.fillStyle = "#1c1b19"; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "left";
    ctx.fillText(`kept ${meta.kept_rate.toFixed(3)}  (${meta.kept}/${meta.T})`, bx + 8, by + 13);
    ctx.fillText(`mel ${meta.mel.toFixed(3)}   SI-SDR ${meta.sisdr.toFixed(1)} dB`, bx + 8, by + 27);
  }

  function drawIntervalLane(ctx, items, lane, xAt, pad, W, txtOf, lineOf, fillOf, textColOf) {
    ctx.strokeStyle = LANE_LINE; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(pad.l, lane.y0); ctx.lineTo(pad.l + W, lane.y0); ctx.stroke();
    for (const it of items) {
      const x0 = xAt(it.t0), x1 = xAt(it.t1), bw = Math.max(1, x1 - x0);
      const fill = fillOf(it);
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, lane.y0 + 1, bw, lane.h - 2); }
      ctx.strokeStyle = lineOf(it); ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x0, lane.y0); ctx.lineTo(x0, lane.y1);
      ctx.moveTo(x1, lane.y0); ctx.lineTo(x1, lane.y1); ctx.stroke();
      const label = txtOf(it);
      if (label) {
        const fs = fitFont(ctx, label, bw, 11, 6);
        if (fs) {
          ctx.fillStyle = textColOf(it);
          ctx.font = `${fs}px system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(label, (x0 + x1) / 2, (lane.y0 + lane.y1) / 2 + 1);
        }
      }
    }
  }

  function timeAt(canvas, masks, clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const L = layout(canvas);
    const u = (x - L.pad.l) / L.W;
    if (u < -0.02 || u > 1.02) return null;
    return Math.max(0, Math.min(masks.duration, u * masks.duration));
  }

  global.GVRWave = { draw, timeAt, layout };
})(window);
