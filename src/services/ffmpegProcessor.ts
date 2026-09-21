import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import type { AudioJob } from '../types'

export type FfmpegProgress = (progress: number) => void

export class LocalFfmpegProcessor {
  readonly assetPath = import.meta.env.VITE_FFMPEG_ASSET_PATH || '/ffmpeg'
  private instance: FFmpeg | null = null
  private loadPromise: Promise<FFmpeg> | null = null

  private async getInstance(): Promise<FFmpeg> {
    if (this.instance?.loaded) return this.instance
    if (this.loadPromise) return this.loadPromise

    const ffmpeg = new FFmpeg()
    this.loadPromise = ffmpeg.load({
      coreURL: `${this.assetPath}/ffmpeg-core.js`,
      wasmURL: `${this.assetPath}/ffmpeg-core.wasm`,
      classWorkerURL: `${this.assetPath}/worker.js`,
    }).then(() => {
      this.instance = ffmpeg
      return ffmpeg
    }).finally(() => {
      this.loadPromise = null
    })

    return this.loadPromise
  }

  async processVideo(
    file: File,
    job: Omit<AudioJob, 'file' | 'format'>,
    format: 'mp4' | 'webm',
    sourceDuration: number,
    onProgress?: FfmpegProgress,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const ffmpeg = await this.getInstance()
    const progressHandler = ({ progress }: { progress: number }) => onProgress?.(progress)
    ffmpeg.on('progress', progressHandler)
    const inputName = `localcut-input-${Date.now()}.${file.name.split('.').pop() || 'bin'}`
    const outputName = `localcut-output.${format}`
    const duration = Math.max(0.05, job.mode === 'remove' ? sourceDuration - (job.end - job.start) : job.end - job.start)
    const fadeDuration = Math.min(0.35, duration / 2)
    const videoFade = [
      job.fadeIn ? `fade=t=in:st=0:d=${fadeDuration.toFixed(3)}` : '',
      job.fadeOut ? `fade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}` : '',
    ].filter(Boolean).join(',')
    const audioFade = [
      job.fadeIn ? `afade=t=in:st=0:d=${fadeDuration.toFixed(3)}` : '',
      job.fadeOut ? `afade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}` : '',
    ].filter(Boolean).join(',')

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file), { signal })

      const args = ['-i', inputName]
      if (job.mode === 'keep') {
        args.push('-ss', job.start.toFixed(3), '-t', duration.toFixed(3), '-map', '0:v:0', '-map', '0:a?')
        if (videoFade) args.push('-vf', videoFade)
        if (audioFade) args.push('-af', audioFade)
      } else {
        const firstEnd = job.start.toFixed(3)
        const secondStart = job.end.toFixed(3)
        const filterParts = [
          `[0:v]trim=start=0:end=${firstEnd},setpts=PTS-STARTPTS[v0]`,
          `[0:v]trim=start=${secondStart},setpts=PTS-STARTPTS[v1]`,
          `[0:a]atrim=start=0:end=${firstEnd},asetpts=PTS-STARTPTS[a0]`,
          `[0:a]atrim=start=${secondStart},asetpts=PTS-STARTPTS[a1]`,
          '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]',
        ]
        const videoOutput = videoFade ? '[vcat]' + videoFade + '[vout]' : '[vcat]null[vout]'
        const audioOutput = audioFade ? '[acat]' + audioFade + '[aout]' : '[acat]anull[aout]'
        filterParts.push(videoOutput, audioOutput)
        args.push('-filter_complex', filterParts.join(';'), '-map', '[vout]', '-map', '[aout]')
      }

      if (format === 'webm') args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '4', '-b:v', '0', '-crf', '32', '-c:a', 'libopus', '-b:a', '128k')
      else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart')
      args.push('-avoid_negative_ts', 'make_zero', outputName)

      const exitCode = await ffmpeg.exec(args, undefined, { signal })
      if (exitCode !== 0) throw new Error(`FFmpeg could not export this video (code ${exitCode}). Try WebM if MP4 is unavailable.`)

      const output = await ffmpeg.readFile(outputName, 'binary', { signal })
      const outputBytes = output as Uint8Array
      const safeBytes = new Uint8Array(outputBytes.byteLength)
      safeBytes.set(outputBytes)
      return new Blob([safeBytes.buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
    } finally {
      ffmpeg.off('progress', progressHandler)
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
    }
  }

  cancel() {
    this.instance?.terminate()
    this.instance = null
    this.loadPromise = null
  }
}
