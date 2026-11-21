// Shared by background, popup and offscreen pages.
const DEFAULT_SETTINGS = {
  apiKey: '',
  sourceLang: 'auto',          // spoken language, or 'auto'
  targetLang: 'none',          // subtitle language, or 'none' = same as spoken
  fontSize: 28,
  showOriginal: false,         // also show the untranslated line
  playSaved: true,             // show saved subtitles in sync, with no lag
  muteOutput: false,           // silence the tab during a preparation pass
  streaming: true,             // low-lag Realtime streaming (~$0.017/min)
  realtimeModel: 'gpt-live-transcribe',
  sttModel: 'gpt-4o-mini-transcribe', // standard mode (~$0.003/min)
  translateModel: 'gpt-4o-mini',
};

const LANGUAGES = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati',
  kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ta: 'Tamil', te: 'Telugu',
  ur: 'Urdu', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', tr: 'Turkish', nl: 'Dutch', pl: 'Polish', sv: 'Swedish',
  id: 'Indonesian', th: 'Thai', vi: 'Vietnamese', fa: 'Persian', he: 'Hebrew',
};
