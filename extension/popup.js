const $ = (id) => document.getElementById(id);
let tab = null;
let running = false;

function bg(msg) {
  return chrome.runtime.sendMessage({ target: 'background', ...msg });
}

// Ask the content script in the current tab (the frame with the video answers).
function page(msg) {
  return chrome.tabs.sendMessage(tab.id, msg).catch(() => null);
}

function setStatus(text, isError = false) {
  $('status').textContent = text || '';
  $('status').classList.toggle('error', isError);
}

function setRunning(on) {
  running = on;
  $('toggle').textContent = on ? 'Stop live subtitles' : 'Start live subtitles';
  $('toggle').classList.toggle('stop', on);
  $('dot').classList.toggle('on', on);
}

async function refreshSaved() {
  const info = await page({ type: 'get-info' });
  const n = info?.count || 0;
  $('saved').textContent = info
    ? n ? `${n} saved lines for this video.` : 'Nothing saved yet. Live subtitles are saved automatically.'
    : 'Reload this page to use saved subtitles here.';
  $('download').disabled = !n;
  $('transcript').disabled = !n;
  $('clear').disabled = !n;
  $('load').disabled = !info;
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  for (const [code, name] of Object.entries(LANGUAGES)) {
    $('sourceLang').add(new Option(name, code));
    $('targetLang').add(new Option(name, code));
  }

  const s = await chrome.storage.local.get(DEFAULT_SETTINGS);
  $('apiKey').value = s.apiKey;
  $('keySection').hidden = !!s.apiKey;
  $('sourceLang').value = s.sourceLang;
  $('targetLang').value = s.targetLang;
  $('fontSize').value = s.fontSize;
  $('fontSizeVal').textContent = `${s.fontSize}px`;
  $('showOriginal').checked = s.showOriginal;
  $('playSaved').checked = s.playSaved;
  $('muteOutput').checked = s.muteOutput;
  $('sttModel').value = s.sttModel;
  $('streaming').checked = s.streaming;
  $('realtimeModel').value = s.realtimeModel;
  $('translateModel').value = s.translateModel;

  const state = await bg({ type: 'get-state' });
  setRunning(state?.activeTabId === tab.id);
  if (state?.activeTabId != null && state.activeTabId !== tab.id) {
    setStatus('Running in another tab. Starting here will stop it.');
  } else {
    setStatus(state?.status);
  }
  refreshSaved();
}

const save = (key, value) => chrome.storage.local.set({ [key]: value });

$('apiKey').addEventListener('change', (e) => save('apiKey', e.target.value.trim()));
$('sourceLang').addEventListener('change', (e) => save('sourceLang', e.target.value));
$('targetLang').addEventListener('change', (e) => save('targetLang', e.target.value));
$('showOriginal').addEventListener('change', (e) => save('showOriginal', e.target.checked));
$('playSaved').addEventListener('change', (e) => save('playSaved', e.target.checked));
$('muteOutput').addEventListener('change', (e) => save('muteOutput', e.target.checked));
$('streaming').addEventListener('change', (e) => save('streaming', e.target.checked));
$('realtimeModel').addEventListener('change', (e) => save('realtimeModel', e.target.value.trim() || DEFAULT_SETTINGS.realtimeModel));
$('sttModel').addEventListener('change', (e) => save('sttModel', e.target.value.trim() || DEFAULT_SETTINGS.sttModel));
$('translateModel').addEventListener('change', (e) => save('translateModel', e.target.value.trim() || DEFAULT_SETTINGS.translateModel));
$('fontSize').addEventListener('input', (e) => {
  $('fontSizeVal').textContent = `${e.target.value}px`;
  save('fontSize', Number(e.target.value));
});
$('changeKey').addEventListener('click', () => {
  $('keySection').hidden = false;
  $('apiKey').focus();
});

$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  try {
    if (running) {
      await bg({ type: 'stop' });
      setRunning(false);
      setStatus('Stopped.');
    } else {
      await save('apiKey', $('apiKey').value.trim());
      if (!$('apiKey').value.trim()) throw new Error('Add your OpenAI API key first.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const res = await bg({ type: 'start', tabId: tab.id, streamId });
      if (!res?.ok) throw new Error(res?.error || 'Could not start.');
      setRunning(true);
      setStatus('Listening… play the video.');
      $('keySection').hidden = true;
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('toggle').disabled = false;
    refreshSaved();
  }
});

function saveFile(title, ext, text, type) {
  const name = (title || 'subtitles').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'subtitles';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = `${name}.${ext}`;
  a.click();
}

$('download').addEventListener('click', async () => {
  const res = await page({ type: 'get-srt' });
  if (!res?.count) return setStatus('Nothing to download yet.', true);
  saveFile(res.title, 'srt', res.srt, 'application/x-subrip');
});

$('transcript').addEventListener('click', async () => {
  const res = await page({ type: 'get-transcript' });
  if (!res?.count) return setStatus('Nothing to download yet.', true);
  saveFile(res.title, 'txt', res.text, 'text/plain;charset=utf-8');
});

$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const res = await page({ type: 'load-srt', srt: await file.text() });
  setStatus(res ? `Loaded ${res.count} lines from ${file.name}.` : 'Could not load the file on this page.', !res);
  refreshSaved();
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Delete the saved subtitles for this video?')) return;
  await page({ type: 'clear-saved' });
  refreshSaved();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'popup' || msg.type !== 'status') return;
  setStatus(msg.status, /error|invalid|quota/i.test(msg.status));
  if (/^Stopped|error|invalid|quota/i.test(msg.status) && !/Retrying/.test(msg.status)) {
    bg({ type: 'get-state' }).then((s) => setRunning(s?.activeTabId === tab.id));
  }
  refreshSaved();
});

init();
