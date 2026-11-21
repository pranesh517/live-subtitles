# Live Subtitles

**Subtitles for any movie or video in your browser, in the language you choose.**

Watching a movie with no subtitles, or none in your language? Live Subtitles
listens to what's being said and shows subtitles on top of the video as it
plays. It can also translate them, so you could watch a Hindi movie with
English subtitles, an English one with Hindi subtitles, and so on.

It works on **YouTube, Netflix, Amazon Prime Video** and any other website that
plays video in the Google Chrome browser (Microsoft Edge and Brave work too).

---

## What you need

1. **A computer with Google Chrome** (or Microsoft Edge or Brave). It doesn't
   work on phones or TVs.
2. **An OpenAI account with a little credit.** OpenAI is the company whose AI
   turns speech into text. Live Subtitles uses your own account, so you pay
   OpenAI directly, and only for what you use (see [How much it costs](#how-much-it-costs)).

---

## Step 1: Get your OpenAI key (one time, about 5 minutes)

The "key" is like a password that lets Live Subtitles use your OpenAI account.

1. Go to **https://platform.openai.com/signup** and create an account (or log in).
2. Add some credit: go to **https://platform.openai.com/settings/organization/billing**,
   click **Add payment details** and add a small amount, for example $5.
   That's enough for many movies.
3. Go to **https://platform.openai.com/api-keys** and click **Create new secret key**.
4. Give it any name (for example "Subtitles") and click **Create secret key**.
5. Click **Copy**. You'll paste it in Step 3. The key starts with `sk-`.

> 🔒 Keep this key private, like a password. Don't share it or post it online.
> Live Subtitles stores it only inside your own browser.

---

## Step 2: Install Live Subtitles (one time, about 3 minutes)

Live Subtitles isn't in the Chrome Web Store, so you install it from this page.

**Download it**

1. At the top of this page, click the green **`<> Code`** button.
2. Click **Download ZIP**.
3. Open your **Downloads** folder and double-click the ZIP file to unzip it.
   You'll get a folder called something like **`live-subtitles-main`**.
   Move it somewhere you won't delete it by accident, such as your
   **Documents** folder. Chrome needs this folder to stay where it is.

**Add it to Chrome**

1. Open Chrome, type **`chrome://extensions`** in the address bar and press **Enter**.
   (In Edge, type `edge://extensions`. In Brave, type `brave://extensions`.)
2. In the top-right corner, turn on **Developer mode**.
3. Click **Load unpacked** (top left).
4. Open the **`live-subtitles-main`** folder, select the **`extension`**
   folder inside it, and click **Select** (on Mac, **Open**).
5. **Live Subtitles** now appears in your list of extensions. 🎉

**Pin it so it's easy to find**

1. Click the **puzzle-piece icon** 🧩 at the top right of Chrome.
2. Click the **pin** 📌 next to **Live Subtitles**.
3. Its icon now stays in your toolbar.

> If Chrome shows a message about "developer mode extensions" when it starts,
> that's normal for extensions installed this way. Just close the message.

---

## Step 3: Watch with subtitles

1. Open the movie or video you want to watch (YouTube, Netflix, Prime Video…).
2. Click the **Live Subtitles** icon in your toolbar.
3. The first time only, paste the key you copied in Step 1 into
   **OpenAI API key**.
4. Choose:
   - **Spoken language:** the language people speak in the movie (for example
     *Hindi*). Choosing it, rather than *Auto-detect*, gives much better results.
   - **Subtitles in:** the language you want to read (for example *English*).
     Choose **Same as spoken** if you don't need a translation.
5. Click **Start live subtitles**.
6. Play the movie. Subtitles appear at the bottom of the video, including in
   full screen.
7. To stop, click the icon again and choose **Stop live subtitles**.

**Tips**

- Subtitles appear about 1–2 seconds after the words are spoken. That's how
  long the AI needs to hear the sentence.
- To make the text bigger or smaller, open the icon, click
  **Display & advanced** and move the **Text size** slider.
- To see the original line as well as the translation, tick
  **Also show original line when translating**.
- If a website was already open before you installed Live Subtitles, refresh
  that page once.

---

## Watching with no delay

If you want subtitles that appear exactly on time, prepare them first:

1. Open the movie, click the Live Subtitles icon, open
   **Prepare ahead (no lag later)** and tick **Mute while preparing**.
2. Click **Start live subtitles** and play the movie, at a faster speed if
   the website lets you (1.5× or 2×). You can leave it running in the background.
3. When it finishes, click **Stop live subtitles** and untick **Mute while preparing**.
4. Now watch the movie normally. The saved subtitles appear exactly in time,
   even when you pause, skip or rewind.

Subtitles are saved automatically for each movie, so this also works when you
come back to a movie later.

---

## Getting all the dialogue

Click the Live Subtitles icon while on the movie's page. Under
**Saved subtitles for this video**:

- **Transcript .txt** downloads all the dialogue as a text file with times,
  which you can read, print or share.
- **.srt** downloads a standard subtitle file that works in players such as VLC.
- **Load .srt…** shows a subtitle file you already have, in time with the video.
- **Clear** deletes the saved subtitles for this movie.

The file only contains the parts of the movie that have been played with
Live Subtitles switched on.

---

## How much it costs

Live Subtitles itself is free. You pay OpenAI for the speech-to-text:

| Setting | Delay | Cost for a 2-hour movie |
| --- | --- | --- |
| **Streaming mode** (on by default) | about 1–2 seconds | about **$2** |
| **Standard mode** | about 2–5 seconds | about **$0.35** |

Translation adds a few cents per movie. Quiet parts of a movie cost nothing.
To switch to the cheaper standard mode, click the icon, open
**Display & advanced** and untick **Streaming mode**.

You can see what you've spent at https://platform.openai.com/usage.

---

## Something not working?

| What you see | What to do |
| --- | --- |
| No subtitles appear | Make sure the video is playing with sound. Refresh the page, then click **Start live subtitles** again. |
| "Add your OpenAI API key first" | Paste your key (Step 1) into the box in the popup. |
| "Incorrect API key" or "invalid" | The key was copied wrongly or deleted. Create a new one (Step 1), then in the popup click **Display & advanced → Change API key**. |
| "quota" or "billing" error | Your OpenAI credit has run out. Add more on the billing page (Step 1). |
| Subtitles are in the wrong language or don't make sense | Set **Spoken language** to the movie's language instead of *Auto-detect*. |
| Songs come out wrong | Songs are hard for any AI because of the music. Normal dialogue works much better. |
| "Streaming unavailable" | Live Subtitles automatically uses standard mode instead. Subtitles still work, with a little more delay. |
| The sound of the movie disappeared | Untick **Mute while preparing** in the popup. |
| Popup says "Reload this page" | Refresh the movie page once. |

---

## Privacy

- Your OpenAI key and settings are saved only in your own browser.
- While subtitles are on, the movie's **sound** (not the picture) is sent to
  OpenAI to be turned into text. Nothing is sent anywhere else.
- Saved subtitles stay on your computer.

---

## For developers

The extension is a Chrome Manifest V3 extension in the [`extension/`](extension/) folder.

- **Audio capture:** `background.js` starts tab audio capture (`chrome.tabCapture`)
  and runs an offscreen document (`offscreen.js`). The offscreen document plays
  the audio back to the user and detects phrases with a simple loudness-based
  voice detector.
- **Streaming mode:** audio is streamed as 24 kHz PCM16 to the OpenAI Realtime
  API (`wss://api.openai.com/v1/realtime?intent=transcription`,
  `gpt-live-transcribe`), authenticated with a short-lived client secret.
  Phrases are committed manually at pauses.
- **Standard mode:** each phrase is sent as a WAV file to `/v1/audio/transcriptions`.
  The extension falls back to this mode automatically if streaming fails.
- **Translation:** each line is translated with `/v1/chat/completions` (`gpt-4o-mini`).
- **Overlay:** `content.js` draws subtitles in a shadow-DOM overlay above the
  largest `<video>`. It maps each cue's wall-clock time to `video.currentTime`,
  so saved cues replay with no lag, and it handles SRT import and export.
- **Popup:** `popup.html` and `popup.js` hold the settings and controls.
