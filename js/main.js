(async function () {
  const BW0 = 1600; // Carver full rate: 25 Hz × 64 dim
  // Latent Rate (Hz × dim); FlexiCodec is discrete RVQ8 → not applicable ("—")
  const BW = {
    mingtok_audio: "3200",
    voxcpm2: "1600",
    dots_tts: "3200",
    semantic_vae: "2560",
    losatok: "3200",
    vibevoice: "480",
    flexicodec_nq8_12hz: "—",
    flexicodec_nq8_8hz: "—",
    ours_orig: String(BW0),
    gt: "—",
  };

  const catalog = await fetch("assets/catalog.json?v=" + Date.now()).then((r) => {
    if (!r.ok) throw new Error("catalog.json missing — run export_demo_assets.py first");
    return r.json();
  });

  const rates = catalog.rates.map((r) => Number(r).toFixed(2));
  let sampleIdx = 0;
  let rateIdx = 0;
  let useAuto = true;  // default: content-adaptive auto
  let masksCache = {};
  let currentMasks = null;
  let raf = 0;

  const baseTabs = document.getElementById("base-tabs");
  const baseBody = document.getElementById("base-body");
  const baseTranscript = document.getElementById("base-transcript");
  const expTabs = document.getElementById("exp-tabs");
  const slider = document.getElementById("rate-slider");
  const rateValue = document.getElementById("rate-value");
  const rateTicks = document.getElementById("rate-ticks");
  const btnAuto = document.getElementById("btn-auto");
  const btnPlay = document.getElementById("btn-play");
  const audio = document.getElementById("exp-audio");
  const canvas = document.getElementById("wave-canvas");
  const stackImg = document.getElementById("stack-img");

  slider.max = String(rates.length - 1);
  // labels: 1.00, 0.80, 0.50, 0.30, 0.05 (middle = 0.50, not 0.55)
  const tickIdx = [0, 4, 10, 14, 19].filter((i) => i < rates.length);
  rateTicks.innerHTML = tickIdx.map((i) => `<span>${rates[i]}</span>`).join("");

  function sid() { return catalog.samples[sampleIdx].id; }
  function sample() { return catalog.samples[sampleIdx]; }

  function nearestRateIdx(r) {
    let best = 0, bestD = Infinity;
    rates.forEach((s, i) => {
      const d = Math.abs(Number(s) - r);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function makeTabs(el, onPick) {
    el.innerHTML = "";
    catalog.samples.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s.label || s.id;
      b.classList.toggle("active", i === sampleIdx);
      b.addEventListener("click", () => {
        sampleIdx = i;
        [...el.querySelectorAll("button")].forEach((x, j) =>
          x.classList.toggle("active", j === i)
        );
        onPick();
      });
      el.appendChild(b);
    });
  }

  function syncTabs() {
    [...expTabs.querySelectorAll("button")].forEach((x, j) =>
      x.classList.toggle("active", j === sampleIdx)
    );
    [...baseTabs.querySelectorAll("button")].forEach((x, j) =>
      x.classList.toggle("active", j === sampleIdx)
    );
  }

  function renderBaselines() {
    const id = sid();
    const s = sample();
    // prefer measured kept_rate from masks if cached; else catalog auto_rate
    let autoKeep = Number(s.auto_rate || 0);
    if (masksCache[id] && masksCache[id].rates && masksCache[id].rates.auto) {
      autoKeep = Number(masksCache[id].rates.auto.kept_rate);
    }
    const autoBw = Math.round(BW0 * autoKeep);

    baseTranscript.textContent = s.transcript ? `“${s.transcript}”` : "";

    const rows = [
      { name: "Ground Truth", meta: "—", src: `assets/samples/${id}/gt.mp3`, ours: false },
      ...catalog.baselines.map((b) => ({
        name: b.name,
        meta: BW[b.id] || "—",
        src: `assets/baselines/${b.id}/${id}.mp3`,
        ours: false,
      })),
      {
        name: "Carver · full rate",
        meta: BW.ours_orig,
        src: `assets/samples/${id}/ours_1.00.mp3`,
        ours: true,
      },
      {
        name: "Carver · auto",
        meta: String(autoBw),
        src: `assets/samples/${id}/ours_auto.mp3`,
        ours: true,
      },
    ];

    baseBody.innerHTML = "";
    for (const c of rows) {
      const tr = document.createElement("tr");
      if (c.ours) tr.classList.add("ours");
      tr.innerHTML = `
        <td class="name">${c.name}</td>
        <td class="bw">${c.meta}</td>
        <td class="listen"><audio controls preload="metadata" src="${c.src}"></audio></td>`;
      baseBody.appendChild(tr);
    }
  }

  async function loadMasks(id) {
    if (!masksCache[id]) {
      masksCache[id] = await fetch(`assets/samples/${id}/masks.json?v=ls7`).then((r) => r.json());
    }
    return masksCache[id];
  }

  function rateKey() {
    return useAuto ? "auto" : rates[rateIdx];
  }

  function redraw(playhead) {
    if (!currentMasks) return;
    const ph = playhead != null ? playhead
      : (!audio.paused || audio.currentTime > 0.01 ? audio.currentTime : null);
    GVRWave.draw(canvas, currentMasks, rateKey(), ph);
  }

  function stopPlayheadLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function startPlayheadLoop() {
    stopPlayheadLoop();
    const tick = () => {
      redraw(audio.currentTime);
      if (!audio.paused && !audio.ended) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        if (audio.ended) redraw(null);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  async function renderExplorer(opts) {
    const keepTime = opts && opts.keepTime;
    const t0 = keepTime ? audio.currentTime : 0;
    const id = sid();
    const masks = await loadMasks(id);
    currentMasks = masks;
    const key = rateKey();

    if (useAuto) {
      // snap slider to nearest discrete gear matching auto rate
      rateIdx = nearestRateIdx(masks.auto_rate);
      slider.value = String(rateIdx);
      rateValue.textContent = `auto (${masks.auto_rate.toFixed(2)})`;
    } else {
      rateValue.textContent = rates[rateIdx];
    }
    btnAuto.classList.toggle("active", useAuto);

    const src = `assets/samples/${id}/ours_${key}.mp3`;
    const cur = audio.getAttribute("src") || "";
    if (cur !== src) {
      audio.src = src;
      audio.load();
    }
    stackImg.src = `figs/${id}_stack.png?v=ls7`;
    syncTabs();
    renderBaselines(); // refresh auto bw once masks known

    const afterReady = () => {
      if (keepTime) {
        try { audio.currentTime = Math.min(t0, masks.duration - 0.01); } catch (_) {}
      } else {
        try { audio.currentTime = 0; } catch (_) {}
      }
      redraw(audio.paused ? (audio.currentTime > 0.01 ? audio.currentTime : null) : audio.currentTime);
    };
    if (audio.readyState >= 1) afterReady();
    else audio.addEventListener("loadedmetadata", afterReady, { once: true });
  }

  function onSamplePick() {
    audio.pause();
    btnPlay.textContent = "▶";
    stopPlayheadLoop();
    renderExplorer({ keepTime: false });
  }

  makeTabs(baseTabs, onSamplePick);
  makeTabs(expTabs, onSamplePick);

  slider.addEventListener("input", () => {
    useAuto = false;
    rateIdx = Number(slider.value);
    audio.pause();
    btnPlay.textContent = "▶";
    stopPlayheadLoop();
    renderExplorer({ keepTime: false });
  });

  btnAuto.addEventListener("click", async () => {
    const masks = await loadMasks(sid());
    useAuto = true;
    rateIdx = nearestRateIdx(masks.auto_rate);
    slider.value = String(rateIdx);
    audio.pause();
    btnPlay.textContent = "▶";
    stopPlayheadLoop();
    renderExplorer({ keepTime: false });
  });

  btnPlay.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
      btnPlay.textContent = "❚❚";
      startPlayheadLoop();
    } else {
      audio.pause();
      btnPlay.textContent = "▶";
      stopPlayheadLoop();
      redraw(audio.currentTime);
    }
  });

  audio.addEventListener("ended", () => {
    btnPlay.textContent = "▶";
    stopPlayheadLoop();
    redraw(null);
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended) redraw(audio.currentTime);
  });

  // click waveform / word lane → seek + play
  canvas.style.cursor = "pointer";
  canvas.title = "Click to play from this time";
  canvas.addEventListener("click", (ev) => {
    if (!currentMasks) return;
    const t = GVRWave.timeAt(canvas, currentMasks, ev.clientX);
    if (t == null) return;
    const seek = () => {
      audio.currentTime = t;
      audio.play();
      btnPlay.textContent = "❚❚";
      startPlayheadLoop();
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });
  });

  window.addEventListener("resize", () => redraw(audio.paused ? audio.currentTime || null : audio.currentTime));

  await renderExplorer({ keepTime: false });
})().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<pre style="padding:1rem;color:#8b3a3a">${err.message}</pre>`
  );
});
