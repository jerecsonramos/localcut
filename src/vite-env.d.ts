/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_FFMPEG_ASSET_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
