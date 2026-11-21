// Offscreen page: captures the tab audio, keeps it audible, finds phrases at
// natural pauses and turns them into subtitles with OpenAI.
//
// Two transcription modes:
//  - Streaming (default, lowest lag): audio goes to the Realtime API over a
//    WebSocket while it is being spoken; partial words are shown as they
//    arrive and each phrase is committed at the next pause.
//  - Standard: each phrase is sent as a WAV file to /audio/transcriptions.
//    Used when streaming is turned off or can't connect.

const OUT_RATE = 24000;        // Realtime API needs 24 kHz PCM16
const FRAME_MS = 100;          // worklet frame size
const SPEECH_RMS = 0.01;       // loudness that counts as "something to transcribe"
const MAX_PARALLEL = 3;        // standard mode: concurrent requests
const MAX_BACKLOG = 4;         // standard mode: drop old chunks rather than fall behind

// Phrase boundaries. Streaming can cut shorter because the server keeps
// earlier phrases as context.
const CHUNKING = {
  streaming: { min: 1000, max: 4000, silence: 300 },
  standard: { min: 1500, max: 5000, silence: 350 },
};

// Phrases speech models tend to invent over music or silence.
const JUNK = [
  /^[\s\p{P}♪♫]*$/u,
  /thank(s| you) (so much )?for watching/i,
  /please (like and )?subscribe/i,
  /subtitles? (by|created|provided)/i,
  /amara\.org/i,
  /^(you|bye)[.!]?$/i,
];

let settings = null;
let mode = 'standard';         // 'streaming' | 'standard'
let stream = null;
let audioCtx = null;
let outGain = null;            // playback volume (0 when muted for a prep pass)
let hadError = false;
let idleTimer = null;
let generation = 0;            // bumps on stop so late API replies are ignored

let frames = [];
let speechFrames = 0;
let silenceRun = 0;
let chunkStart = 0;
let lastFrameAt = 0;

const recent = [];             // last few transcribed lines, for context

function send(msg) {
  return chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'start') {
    start(msg.streamId, msg.settings).then(
      () => sendResponse({ ok: true, mode }),
      (err) => sendResponse({ ok: false, error: err.message }),
    );
    return true;
  }
  if (msg.type === 'stop') {
    stop();
    sendResponse({ ok: true });
  } else if (msg.type === 'settings') {
    const restartStreaming = mode === 'streaming' &&
      ['sourceLang', 'realtimeModel'].some((k) => msg.settings[k] !== settings[k]);
    settings = msg.settings;
    if (outGain) outGain.gain.value = settings.muteOutput ? 0 : 1;
    if (restartStreaming) rt.reconnect();
  }
  return false;
});

async function start(streamId, initialSettings) {
  stop();
  settings = initialSettings;
  const gen = generation;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  // Capturing a tab mutes it, so play the audio back to the user (unless
  // they're doing a silent preparation pass).
  outGain = audioCtx.createGain();
  outGain.gain.value = settings.muteOutput ? 0 : 1;
  source.connect(outGain).connect(audioCtx.destination);

  mode = 'standard';
  if (settings.streaming) {
    try {
      await rt.connect(gen);
      mode = 'streaming';
    } catch (err) {
      send({ type: 'status', status: `Streaming unavailable (${err.message}). Using standard mode.` });
    }
  }
  if (gen !== generation) return;

  await audioCtx.audioWorklet.addModule('pcm-worklet.js');
  if (gen !== generation) return;
  const node = new AudioWorkletNode(audioCtx, 'pcm-capture');
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  source.connect(node).connect(sink).connect(audioCtx.destination);
  node.port.onmessage = (e) => onFrame(e.data);

  // If audio stops arriving (paused video), don't leave a phrase hanging.
  idleTimer = setInterval(() => {
    if (frames.length && Date.now() - lastFrameAt > 800) flush();
  }, 500);
}

function stop() {
  generation++;
  clearInterval(idleTimer);
  idleTimer = null;
  rt.close();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  outGain = null;
  hadError = false;
  resetChunk();
  std.reset();
  recent.length = 0;
}

// Fall back for the rest of the session when streaming breaks.
function useStandardMode(reason) {
  if (mode !== 'streaming') return;
  mode = 'standard';
  rt.close();
  resetChunk();
  send({ type: 'status', status: `Streaming stopped (${reason}). Using standard mode.` });
}

// ---------- phrase detection ----------

function resetChunk() {
  frames = [];
  speechFrames = 0;
  silenceRun = 0;
}

function onFrame(raw) {
  const now = Date.now();
  lastFrameAt = now;
  const pcm = downsample(raw, audioCtx.sampleRate);
  const speech = rms(pcm) > SPEECH_RMS;

  if (!frames.length) chunkStart = now - FRAME_MS;
  frames.push(pcm);
  if (speech) {
    speechFrames++;
    silenceRun = 0;
  } else {
    silenceRun++;
  }

  // Trim leading silence so the phrase (and its timestamp) starts near speech.
  if (speechFrames === 0 && frames.length > 3) {
    frames.shift();
    chunkStart += FRAME_MS;
  }

  if (mode === 'streaming' && speechFrames > 0) {
    // Send audio as it happens; on the first speech frame include the short
    // lead-in kept above.
    if (speechFrames === 1 && speech) {
      rt.beginPhrase(chunkStart);
      frames.forEach((f) => rt.append(f));
    } else {
      rt.append(pcm);
    }
  }

  const c = CHUNKING[mode];
  const duration = frames.length * FRAME_MS;
  if ((duration >= c.min && silenceRun * FRAME_MS >= c.silence) || duration >= c.max) flush();
}

function flush() {
  if (!frames.length) return;
  const chunk = frames;
  const hasSpeech = speechFrames >= 3;
  const sentAny = speechFrames > 0;
  const start = chunkStart;
  const end = start + chunk.length * FRAME_MS;
  resetChunk();

  if (mode === 'streaming') {
    if (hasSpeech) rt.commit(end);
    else if (sentAny) rt.discard();
    return;
  }
  if (hasSpeech) std.enqueue(chunk, start, end);
}

function downsample(input, fromRate) {
  if (fromRate === OUT_RATE) return input;
  const ratio = fromRate / OUT_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = sum / (b - a);
  }
  return out;
}

function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / (pcm.length || 1));
}

function toPcm16(chunks, offset = 0) {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const view = new DataView(new ArrayBuffer(offset + samples * 2));
  let o = offset;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return view;
}

function encodeWav(chunks) {
  const v = toPcm16(chunks, 44);
  const data = v.byteLength - 44;
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, OUT_RATE, true); v.setUint32(28, OUT_RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  return new Blob([v.buffer], { type: 'audio/wav' });
}

function base64Pcm16(f32) {
  const bytes = new Uint8Array(toPcm16([f32]).buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- shared: clean up, translate, emit ----------

// Returns a finished cue, or null if the text is empty / junk.
async function finishLine(raw, start, end) {
  const original = dedupe(raw.trim());
  if (!original || JUNK.some((re) => re.test(original))) return null;

  const target = settings.targetLang;
  let text = original;
  if (target !== 'none' && target !== settings.sourceLang) text = await translate(original, target);

  recent.push(original);
  if (recent.length > 3) recent.shift();
  return { text, original: text !== original ? original : '', start, end };
}

function emitCue(cue) {
  send({ type: 'cue', cue });
  if (hadError) {
    hadError = false;
    send({ type: 'status', status: 'Listening…' });
  }
}

// Songs (and speech models over music) repeat a lot. Collapse a phrase that is
// repeated back-to-back inside one line, and drop the start of a line that
// just repeats the previous one.
function dedupe(text) {
  let words = text.split(/\s+/).filter(Boolean);
  const norm = (w) => w.toLowerCase().replace(/[\p{P}]/gu, '');
  for (let len = Math.floor(words.length / 2); len >= 3; len--) {
    for (let i = 0; i + 2 * len <= words.length; i++) {
      const same = words.slice(i, i + len).every((w, k) => norm(w) === norm(words[i + len + k]));
      if (same) {
        words.splice(i + len, len);
        i--;
      }
    }
  }
  const prev = (recent[recent.length - 1] || '').split(/\s+/).filter(Boolean).map(norm);
  if (prev.length >= 3) {
    let n = 0;
    while (n < words.length && n < prev.length && norm(words[n]) === prev[n]) n++;
    if (n === words.length) return '';           // exact repeat of last line
    if (n >= 3) words = words.slice(n);
  }
  return words.join(' ');
}

// ---------- streaming mode (Realtime API) ----------

const rt = {
  ws: null,
  gen: -1,
  ready: false,
  gotText: false,      // has the server ever returned a transcript?
  phrases: [],         // phrases sent but not yet tied to a server item, oldest first
  current: null,       // phrase currently being sent
  items: new Map(),    // server item_id -> phrase { start, end, text }

  sessionConfig() {
    const model = settings.realtimeModel;
    const transcription = { model };
    if (settings.sourceLang !== 'auto') {
      // The newer live models take a list; older ones a single code.
      if (/^gpt-(live-)?transcribe/.test(model)) transcription.languages = [settings.sourceLang];
      else transcription.language = settings.sourceLang;
    }
    return {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: OUT_RATE },
          transcription,
          turn_detection: null,   // we decide where phrases end (see onFrame)
          noise_reduction: null,  // movie audio, not a microphone
        },
      },
    };
  },

  async connect(gen) {
    this.gen = gen;
    const secret = await openai('realtime/client_secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: this.sessionConfig(),
      }),
    });
    if (!secret.value) throw new Error('no session key returned');
    if (gen !== generation) return;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription',
        ['realtime', `openai-insecure-api-key.${secret.value}`]);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('connection timed out')), 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'session.update', session: this.sessionConfig() }));
        this.ready = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('could not connect'));
      };
      ws.onmessage = (e) => this.onEvent(JSON.parse(e.data));
      ws.onclose = () => this.onClose(ws);
    });
  },

  close() {
    this.ready = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.phrases = [];
    this.current = null;
    this.items.clear();
  },

  // Sessions have a time limit, so reconnect when the server closes one.
  async reconnect() {
    const gen = generation;
    this.close();
    try {
      await this.connect(gen);
    } catch (err) {
      if (gen === generation) useStandardMode(err.message);
    }
  },

  onClose(ws) {
    if (ws !== this.ws || this.gen !== generation || mode !== 'streaming') return;
    this.reconnect();
  },

  sendEvent(event) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  },

  beginPhrase(start) {
    this.current = { start, end: start, text: '' };
    this.phrases.push(this.current);
  },

  append(pcm) {
    this.sendEvent({ type: 'input_audio_buffer.append', audio: base64Pcm16(pcm) });
  },

  commit(end) {
    if (this.current) this.current.end = end;
    this.current = null;
    this.sendEvent({ type: 'input_audio_buffer.commit' });
  },

  discard() {
    if (this.current) this.phrases.splice(this.phrases.indexOf(this.current), 1);
    this.current = null;
    this.sendEvent({ type: 'input_audio_buffer.clear' });
  },

  // Items arrive in the same order as our phrases.
  phraseFor(itemId) {
    if (!itemId) return null;
    if (!this.items.has(itemId)) {
      const phrase = this.phrases.shift();
      if (!phrase) return null;
      this.items.set(itemId, phrase);
    }
    return this.items.get(itemId);
  },

  async onEvent(ev) {
    if (this.gen !== generation) return;
    switch (ev.type) {
      case 'input_audio_buffer.committed':
        this.phraseFor(ev.item_id);
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        const p = this.phraseFor(ev.item_id);
        if (!p || !ev.delta) break;
        p.text += ev.delta;
        const target = settings.targetLang;
        const translating = target !== 'none' && target !== settings.sourceLang;
        send({ type: 'partial', text: p.text.trim(), translating });
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const p = this.phraseFor(ev.item_id);
        this.items.delete(ev.item_id);
        this.gotText = true;
        if (!p) break;
        try {
          const cue = await finishLine(ev.transcript || p.text, p.start, p.end);
          if (cue && this.gen === generation) emitCue(cue);
        } catch (err) {
          handleError(err);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.failed':
        this.items.delete(ev.item_id);
        break;
      case 'error': {
        const message = ev.error?.message || 'unknown error';
        const code = ev.error?.code || '';
        if (/api.key|auth|quota/i.test(`${code} ${message}`)) {
          send({ type: 'fatal', status: `OpenAI error: ${message}` });
        } else if (!this.gotText) {
          // Before anything has worked, assume the setup itself is the problem.
          useStandardMode(message);
        } else {
          hadError = true;
          send({ type: 'status', status: `Streaming error: ${message}` });
        }
        break;
      }
    }
  },
};

// ---------- standard mode (one request per phrase) ----------

const std = {
  seq: 0,
  nextEmit: 0,
  inFlight: 0,
  queue: [],
  results: new Map(),

  reset() {
    this.queue.length = 0;
    this.results.clear();
    this.seq = this.nextEmit = this.inFlight = 0;
  },

  enqueue(chunk, start, end) {
    this.queue.push({ id: this.seq++, wav: encodeWav(chunk), start, end });
    while (this.queue.length > MAX_BACKLOG) this.results.set(this.queue.shift().id, null);
    this.emitInOrder();
    this.pump();
  },

  pump() {
    while (this.inFlight < MAX_PARALLEL && this.queue.length) this.run(this.queue.shift());
  },

  async run(job) {
    const gen = generation;
    this.inFlight++;
    let cue = null;
    try {
      cue = await finishLine(await transcribe(job.wav), job.start, job.end);
    } catch (err) {
      if (gen === generation) handleError(err);
    }
    if (gen !== generation) return;
    this.inFlight--;
    this.results.set(job.id, cue);
    this.emitInOrder();
    this.pump();
  },

  emitInOrder() {
    while (this.results.has(this.nextEmit)) {
      const cue = this.results.get(this.nextEmit);
      this.results.delete(this.nextEmit++);
      if (cue) emitCue(cue);
    }
  },
};

// ---------- OpenAI HTTP calls ----------

async function openai(path, init) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${settings.apiKey}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    let message = `OpenAI error ${res.status}`;
    let code = '';
    try {
      const body = await res.json();
      if (body.error?.message) message += `: ${body.error.message}`;
      code = body.error?.code || '';
    } catch {}
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res.json();
}

async function transcribe(wav) {
  const form = new FormData();
  form.append('file', wav, 'chunk.wav');
  form.append('model', settings.sttModel);
  form.append('response_format', 'json');
  if (settings.sourceLang !== 'auto') form.append('language', settings.sourceLang);
  const body = await openai('audio/transcriptions', { method: 'POST', body: form });
  return (body.text || '').trim();
}

async function translate(text, target) {
  const lang = LANGUAGES[target] || target;
  const spoken = settings.sourceLang !== 'auto' ? LANGUAGES[settings.sourceLang] || settings.sourceLang : '';
  const context = recent.length
    ? `Earlier lines, for context only (do not translate them):\n${recent.join('\n')}\n\n`
    : '';
  const body = await openai('chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.translateModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            `You write ${lang} subtitles for movies, TV and songs. The text comes from automatic ` +
            `speech recognition, often over music, so it can be noisy: words may be misheard, ` +
            `written phonetically or in the wrong script (for example Malayalam written in Tamil ` +
            `script), and several languages may be mixed in one line (common in Indian films). ` +
            (spoken ? `The audio is mainly in ${spoken}. ` : '') +
            `Work out what was most likely said and translate its meaning naturally, keeping it ` +
            `poetic if it is a song lyric. Do not translate sounds literally, and never invent ` +
            `names from misheard words. If a part is unintelligible, leave it out. ` +
            `Reply with only the ${lang} subtitle, without quotes, notes or explanations.`,
        },
        { role: 'user', content: `${context}Translate this line:\n${text}` },
      ],
    }),
  });
  return (body.choices?.[0]?.message?.content || text).trim();
}

function handleError(err) {
  const fatal = err.status === 401 || err.status === 403 || err.code === 'insufficient_quota';
  if (fatal) {
    send({ type: 'fatal', status: err.message });
  } else {
    hadError = true;
    send({ type: 'status', status: `Retrying after error: ${err.message}` });
  }
}
