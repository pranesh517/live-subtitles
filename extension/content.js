// Content script: draws subtitles over the biggest video on the page.
//
// Two modes:
//  - Live: cues arrive from the transcriber a few seconds late. Each one is
//    mapped back to the video's own timeline and saved for this page.
//  - Saved (no lag): when this page has saved cues (from an earlier live
//    pass or a loaded .srt) they are shown in sync with video.currentTime.
(() => {
  if (window.__liveSubtitlesLoaded) return;
  window.__liveSubtitlesLoaded = true;

  const isTop = window === window.top;
  let prefs = { fontSize: 28, showOriginal: false, playSaved: true };
  let live = false;
  let host = null;
  let box = null;
  let mainLine = null;
  let origLine = null;
  let hideTimer = null;
  let layoutTimer = null;
  let sampleTimer = null;
  let sessionStart = 0;
  let saveTimer = null;
  let shownSaved = null;
  let cuesKey = null;
  const timeline = []; // { wall, vt, paused, rate } samples
  let cues = [];       // { start, end, text, original } in video seconds, sorted

  // ---------- page identity & storage ----------

  // One key per title: Netflix /watch/<id>, YouTube ?v=<id>, etc.
  function pageKey() {
    const u = new URL(location.href);
    const v = u.searchParams.get('v');
    return `subs:${u.origin}${u.pathname}${v ? `?v=${v}` : ''}`;
  }

  async function loadCues() {
    cuesKey = pageKey();
    const data = await chrome.storage.local.get(cuesKey);
    cues = data[cuesKey]?.cues || [];
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    const key = cuesKey;
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [key]: { title: document.title, cues, savedAt: Date.now() } });
    }, 2000);
  }

  function addCue(cue) {
    // Drop older cues that this one overlaps (e.g. re-transcribing a section).
    cues = cues.filter((c) => c.end <= cue.start + 0.2 || c.start >= cue.end - 0.2);
    cues.push(cue);
    cues.sort((a, b) => a.start - b.start);
    saveSoon();
  }

  // SPAs (YouTube, Netflix) change titles without reloading the page.
  setInterval(() => {
    if (pageKey() !== cuesKey) {
      clearTimeout(saveTimer);
      shownSaved = null;
      loadCues();
    }
  }, 1000);

  chrome.storage.local.get(prefs).then((p) => {
    prefs = p;
    applyPrefs();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k of ['fontSize', 'showOriginal', 'playSaved']) {
      if (changes[k]) prefs[k] = changes[k].newValue;
    }
    applyPrefs();
  });

  // ---------- overlay ----------

  function findVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.width >= 200 && area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  // Draw in the frame that holds the video. The top frame also draws when it
  // has no video and no large iframe that might hold one.
  function shouldRender() {
    if (findVideo()) return true;
    if (!isTop) return false;
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      if (r.width > 300 && r.height > 150) return false;
    }
    return true;
  }

  function ensureOverlay() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-live-subtitles', '');
    const css = {
      position: 'fixed', 'z-index': '2147483647', 'pointer-events': 'none',
      margin: '0', padding: '0', border: '0', left: '0', bottom: '8%', width: '100%',
      display: 'flex', 'justify-content': 'center',
    };
    for (const [k, v] of Object.entries(css)) host.style.setProperty(k, v, 'important');

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box { max-width: 86%; text-align: center; opacity: 0; transition: opacity .15s;
               font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans", Arial, sans-serif; }
        .box.visible { opacity: 1; }
        .line { display: inline; padding: .1em .45em; line-height: 1.45;
                background: rgba(0,0,0,.72); color: #fff; border-radius: 4px;
                -webkit-box-decoration-break: clone; box-decoration-break: clone;
                text-shadow: 0 1px 2px #000; white-space: pre-wrap; }
        .orig { font-size: .7em; color: #ddd; }
        .orig:empty, .orig.hidden { display: none; }
        .notice .main { background: rgba(160,20,20,.85); }
        .partial .main { color: #e8e8e8; }
      </style>
      <div class="box"><div><span class="line orig"></span></div><div><span class="line main"></span></div></div>`;
    box = root.querySelector('.box');
    mainLine = root.querySelector('.main');
    origLine = root.querySelector('.orig');
    applyPrefs();
    document.documentElement.appendChild(host);
  }

  function layout() {
    if (!host) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    // In fullscreen only the fullscreen element is visible, so live inside it.
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);

    const v = findVideo();
    let left = 0;
    let width = innerWidth;
    let bottom = innerHeight * 0.08;
    if (v) {
      const r = v.getBoundingClientRect();
      left = Math.max(0, r.left);
      width = Math.max(200, Math.min(innerWidth, r.right) - left);
      const visibleBottom = Math.min(innerHeight, r.bottom);
      bottom = innerHeight - visibleBottom + Math.min(r.height, innerHeight) * 0.1;
    }
    host.style.setProperty('left', `${left}px`, 'important');
    host.style.setProperty('width', `${width}px`, 'important');
    host.style.setProperty('bottom', `${Math.max(0, bottom)}px`, 'important');
    const scale = Math.max(0.6, Math.min(1.6, width / 1280));
    box.style.fontSize = `${Math.round(prefs.fontSize * scale)}px`;
  }

  function applyPrefs() {
    if (!box) return;
    origLine.classList.toggle('hidden', !prefs.showOriginal);
    if (!prefs.playSaved && !live) hide();
    layout();
  }

  function render(text, original, notice) {
    ensureOverlay();
    layout();
    box.classList.toggle('notice', notice);
    box.classList.remove('partial');
    mainLine.textContent = text;
    origLine.textContent = original || '';
    box.classList.add('visible');
  }

  function hide() {
    clearTimeout(hideTimer);
    box?.classList.remove('visible');
  }

  // Live cues and notices: show now, hide after a reading-time delay.
  function flash(text, original = '', notice = false) {
    render(text, original, notice);
    clearTimeout(hideTimer);
    const ms = notice ? 8000 : Math.min(8000, Math.max(2500, text.length * 70));
    hideTimer = setTimeout(hide, ms);
  }

  // ---------- saved (no lag) playback ----------

  function cueAt(t) {
    let lo = 0;
    let hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) lo = mid + 1;
      else hi = mid - 1;
    }
    const c = cues[hi];
    return c && t < Math.max(c.end, c.start + 1.5) ? c : null;
  }

  setInterval(() => {
    if (live || !prefs.playSaved || !cues.length) return;
    const v = findVideo();
    if (!v) return;
    const c = cueAt(v.currentTime);
    if (c === shownSaved) return;
    shownSaved = c;
    if (c) render(c.text, c.original, false);
    else hide();
  }, 150);

  // ---------- live mode timing ----------

  function sample() {
    const wall = Date.now();
    const v = findVideo();
    timeline.push(v
      ? { wall, vt: v.currentTime, paused: v.paused, rate: v.playbackRate || 1 }
      : { wall, vt: (wall - sessionStart) / 1000, paused: false, rate: 1 });
    if (timeline.length > 600) timeline.shift(); // ~2.5 minutes
  }

  // Convert a wall-clock time to the video's position at that moment.
  function videoTimeAt(wall) {
    let s = timeline[0];
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].wall <= wall) {
        s = timeline[i];
        break;
      }
    }
    if (!s) return Math.max(0, (wall - sessionStart) / 1000);
    return Math.max(0, s.vt + (s.paused ? 0 : ((wall - s.wall) / 1000) * s.rate));
  }

  function begin() {
    live = true;
    sessionStart = Date.now();
    timeline.length = 0;
    sample();
    clearInterval(sampleTimer);
    clearInterval(layoutTimer);
    sampleTimer = setInterval(sample, 250);
    layoutTimer = setInterval(layout, 500);
  }

  function end() {
    live = false;
    shownSaved = null;
    clearInterval(sampleTimer);
    clearInterval(layoutTimer);
    hide();
  }

  // ---------- SRT ----------

  function srtTime(sec) {
    const ms = Math.round(sec * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:` +
      `${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  }

  function buildSrt() {
    return cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 1))}\n${c.text}\n`)
      .join('\n');
  }

  function buildTranscript() {
    const stamp = (sec) => srtTime(sec).slice(0, 8);
    const lines = cues.map((c) => `[${stamp(c.start)}] ${c.text}${c.original ? `\n           (${c.original})` : ''}`);
    return `${document.title}\n${'='.repeat(Math.min(60, document.title.length || 10))}\n\n${lines.join('\n')}\n`;
  }

  function parseSrt(srt) {
    const toSec = (s) => {
      const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
      if (!m) return NaN;
      return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +`0.${m[4]}`;
    };
    const out = [];
    for (const block of srt.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      const start = toSec(a);
      const end = toSec(b);
      const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (text && !Number.isNaN(start) && !Number.isNaN(end)) out.push({ start, end, text, original: '' });
    }
    return out.sort((x, y) => x.start - y.start);
  }

  document.addEventListener('fullscreenchange', layout);
  document.addEventListener('webkitfullscreenchange', layout);
  addEventListener('resize', layout);

  // Only the frame that owns the video answers popup questions.
  const owner = () => (findVideo() ? true : isTop && shouldRender());

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'ping':
        if (isTop) sendResponse({ ok: true });
        break;
      case 'started':
        begin();
        break;
      case 'stopped':
        end();
        break;
      case 'cue': {
        if (!live) begin();
        if (!shouldRender()) break;
        const { text, original, start, end: stop } = msg.cue;
        addCue({ start: videoTimeAt(start), end: videoTimeAt(stop), text, original });
        flash(text, original);
        break;
      }
      case 'partial':
        if (!msg.text || !shouldRender()) break;
        if (msg.translating) {
          // Never cover the translated line with untranslated words. Show
          // them only in the small "original" line, and only if wanted.
          if (prefs.showOriginal && box) origLine.textContent = msg.text;
          break;
        }
        // Words as they're recognised; replaced by the finished line.
        flash(msg.text);
        box.classList.add('partial');
        break;
      case 'notice':
        if (shouldRender()) flash(msg.text, '', true);
        break;
      case 'get-info':
        if (owner()) sendResponse({ count: cues.length, hasVideo: !!findVideo() });
        break;
      case 'get-srt':
        if (owner()) sendResponse({ srt: buildSrt(), title: document.title, count: cues.length });
        break;
      case 'get-transcript':
        if (owner()) sendResponse({ text: buildTranscript(), title: document.title, count: cues.length });
        break;
      case 'load-srt':
        if (owner()) {
          cues = parseSrt(msg.srt);
          shownSaved = null;
          saveSoon();
          sendResponse({ count: cues.length });
        }
        break;
      case 'clear-saved':
        if (owner()) {
          cues = [];
          shownSaved = null;
          hide();
          chrome.storage.local.remove(cuesKey);
          sendResponse({ count: 0 });
        }
        break;
    }
    return false;
  });

  loadCues();
})();
