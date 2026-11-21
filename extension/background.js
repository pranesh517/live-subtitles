// Service worker: owns the capture session and routes messages between the
// popup, the offscreen audio page and the content script in the video tab.
importScripts('defaults.js');

const OFFSCREEN_URL = 'offscreen.html';

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Listen to the tab audio to generate live subtitles.',
  });
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

async function getActiveTabId() {
  const { activeTabId } = await chrome.storage.session.get('activeTabId');
  return activeTabId ?? null;
}

async function setStatus(status) {
  await chrome.storage.session.set({ status });
  chrome.runtime.sendMessage({ target: 'popup', type: 'status', status }).catch(() => {});
}

function sendToTab(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// Tabs opened before the extension was installed don't have the content
// script yet, so inject it on demand.
async function ensureContentScript(tabId) {
  const alive = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
  if (alive) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function start(tabId, streamId) {
  if ((await getActiveTabId()) !== null) await stop();

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) throw new Error('Add your OpenAI API key first.');

  await ensureContentScript(tabId);
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, settings });
  if (!res?.ok) {
    await closeOffscreen();
    throw new Error(res?.error || 'Could not capture the tab audio.');
  }

  await chrome.storage.session.set({ activeTabId: tabId });
  sendToTab(tabId, { type: 'started' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ tabId, text: 'ON' });
  await setStatus(res.mode === 'streaming' ? 'Listening (streaming, low lag)…' : 'Listening…');
}

async function stop(finalStatus = 'Stopped.') {
  const tabId = await getActiveTabId();
  await chrome.storage.session.remove('activeTabId');
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    await closeOffscreen();
  }
  if (tabId !== null) {
    sendToTab(tabId, { type: 'stopped' });
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
  await setStatus(finalStatus);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;

  (async () => {
    switch (msg.type) {
      case 'start':
        await start(msg.tabId, msg.streamId);
        return { ok: true };
      case 'stop':
        await stop();
        return { ok: true };
      case 'get-state': {
        const { status = '' } = await chrome.storage.session.get('status');
        return { ok: true, activeTabId: await getActiveTabId(), status };
      }
      case 'cue': {
        const tabId = await getActiveTabId();
        if (tabId !== null) sendToTab(tabId, { type: 'cue', cue: msg.cue });
        return { ok: true };
      }
      case 'partial': {
        const tabId = await getActiveTabId();
        if (tabId !== null) sendToTab(tabId, { type: 'partial', text: msg.text, translating: msg.translating });
        return { ok: true };
      }
      case 'status':
        await setStatus(msg.status);
        return { ok: true };
      case 'fatal': {
        const tabId = await getActiveTabId();
        if (tabId !== null) sendToTab(tabId, { type: 'notice', text: msg.status });
        await stop(msg.status);
        return { ok: true };
      }
      default:
        return { ok: false, error: `Unknown message ${msg.type}` };
    }
  })().then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));

  return true; // async response
});

// Push language/model changes to a running session.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some((k) => k in DEFAULT_SETTINGS)) return;
  if (!(await hasOffscreen())) return;
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'settings', settings }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === (await getActiveTabId())) await stop();
});
