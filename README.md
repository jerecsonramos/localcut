# LocalCut

LocalCut is a privacy-first, offline-first audio and video trimming PWA. It is intentionally scoped to one useful flow:

`Open audio → select a region → preview the edit → export`

## Run locally

```bash
npm install
npm run dev
```

On Windows, you can double-click `Run LocalCut.cmd`. It runs `run-localcut.ps1`, installs dependencies on the first launch, starts the Vite server, and opens the app automatically.

The production build is generated with `npm run build` and includes a Workbox service worker plus a web app manifest. The app has no API calls, analytics, uploads, or remote font dependencies.

## Build the Windows installer

The desktop installer is built with Electron and packages the production app, including the local FFmpeg assets. Run:

```bash
npm run desktop:build
```

The NSIS installer is written to `release/LocalCut Setup 0.1.0.exe`. It creates a Start Menu entry and a desktop shortcut, and lets the user choose the installation directory. `npm run desktop:dev` builds the app and opens the packaged desktop shell for a quick local check.

The default build is unsigned for local development. For a release build, `desktop:build:signed` requires either a PFX Authenticode certificate or Azure Artifact Signing credentials; it refuses to produce an unsigned installer.

For a PFX certificate, set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. For Azure Artifact Signing (formerly Trusted Signing), set `LOCALCUT_SIGNING_PROVIDER=azure`, `LOCALCUT_AZURE_PUBLISHER_NAME`, `LOCALCUT_AZURE_ENDPOINT`, `LOCALCUT_AZURE_ACCOUNT_NAME`, `LOCALCUT_AZURE_CERTIFICATE_PROFILE_NAME`, and the Azure authentication variables required by the signing service. Then run:

```powershell
npm run desktop:build:signed
```

Keep certificate passwords and Azure secrets outside the repository. The Azure configuration follows electron-builder's v26 signing integration and Microsoft's Artifact Signing setup.

## Processing architecture

- `src/services/audioProcessor.ts` owns decoding, waveform peak generation, selection rendering, fades, WAV encoding, and browser MediaRecorder codec detection.
- `WaveformEditor` in `src/App.tsx` owns only visualization and selection input. It never encodes or uploads audio.
- Playback uses an `AudioBufferSourceNode`, so previews use the exact same local processed buffer that WAV export uses.
- `src/services/ffmpegProcessor.ts` owns local MP4/WebM video export through FFmpeg WASM. The Vite build copies the official single-thread core and worker assets into `/ffmpeg`; no CDN fallback exists.
- `src/workers/ffmpeg.worker.ts` remains the extension seam for a custom worker pipeline if the app later needs streaming or multithreaded processing.
- Video timelines can be clicked or dragged to scrub the local preview frame. Selection handles, keyboard nudges, and time fields keep the paused video frame in sync.

## Format behavior

WAV export is implemented in-app with a PCM encoder. OGG/Opus, M4A/AAC, MP3, and FLAC are exposed when the current browser advertises a matching `MediaRecorder` codec. Video export supports MP4 (H.264 + AAC) and WebM (VP9 + Opus) through the self-hosted FFmpeg core. If a browser/container cannot decode an audio track for waveform generation, video playback and timestamp trimming remain available.

## Privacy and memory notes

Audio is decoded from the selected `File` directly into a local `AudioBuffer`; video is previewed through a local object URL and encoded inside the local FFmpeg worker. Nothing is sent to a server. Waveform data stores only a compact peak array. Temporary object URLs are revoked after download or file replacement. For very large sources, the next scaling step is moving decode work into the reserved worker and using a streaming WASM pipeline.

The app does not persist audio or video in IndexedDB. The service worker caches the app shell plus the self-hosted FFmpeg assets, never user-selected files. The single-thread FFmpeg core is intentionally used so SharedArrayBuffer/COOP/COEP headers are not required for this version.
