import type { AudioJob } from '../types'

/**
 * The heavyweight codec path is intentionally isolated from the editor.
 * When a self-hosted FFmpeg bundle is added under /ffmpeg, this adapter is the
 * only seam that needs to change; the waveform and selection UI stay unaware.
 */
export class LocalFfmpegProcessor {
  readonly assetPath = import.meta.env.VITE_FFMPEG_ASSET_PATH || '/ffmpeg'

  async process(_job: AudioJob): Promise<Blob> {
    throw new Error(`FFmpeg WASM assets are not installed at ${this.assetPath}. Use WAV or a browser-supported codec.`)
  }
}
