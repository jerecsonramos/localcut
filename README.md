# LocalCut

LocalCut is a privacy-first, offline-first audio trimming PWA. It is intentionally scoped to one useful flow:

`Open audio → select a region → preview the edit → export`

## Run locally

```bash
npm install
npm run dev
```

On Windows, you can double-click `Run LocalCut.cmd`. It runs `run-localcut.ps1`, installs dependencies on the first launch, starts the Vite server, and opens the app automatically.

The production build is generated with `npm run build` and includes a Workbox service worker plus a web app manifest. The app has no API calls, analytics, uploads, or remote font dependencies.

## Processing architecture

- `src/services/audioProcessor.ts` owns decoding, waveform peak generation, selection rendering, fades, WAV encoding, and browser MediaRecorder codec detection.
- `WaveformEditor` in `src/App.tsx` owns only visualization and selection input. It never encodes or uploads audio.
- Playback uses an `AudioBufferSourceNode`, so previews use the exact same local processed buffer that WAV export uses.
- `src/services/ffmpegProcessor.ts` is the isolated adapter seam for heavier codecs. It intentionally fails closed until a self-hosted FFmpeg WASM bundle is installed under `/ffmpeg` (or `VITE_FFMPEG_ASSET_PATH` is configured). No CDN fallback exists.
- `src/workers/ffmpeg.worker.ts` reserves a worker boundary for the FFmpeg implementation so a future codec bundle does not block React rendering.

## Format behavior

WAV export is implemented in-app with a PCM encoder. OGG/Opus, M4A/AAC, MP3, and FLAC are exposed when the current browser advertises a matching `MediaRecorder` codec. If a codec is not supported, LocalCut explains the limitation and keeps WAV available. A self-hosted FFmpeg adapter can add deterministic cross-browser output without changing the editor UI.

## Privacy and memory notes

Audio is decoded from the selected `File` directly into a local `AudioBuffer`; it is never sent to a server. Waveform data stores only a compact peak array. Temporary export object URLs are revoked after download. For very large sources, the next scaling step is moving decode/encode work into the reserved worker and using a streaming WASM pipeline.

The app does not persist audio in IndexedDB. The service worker caches only the app shell and static processing assets, never user-selected files.
