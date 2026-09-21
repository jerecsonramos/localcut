export type EditMode = 'keep' | 'remove'

export type OutputFormat = 'wav' | 'mp3' | 'm4a' | 'flac' | 'ogg'

export type WaveformData = {
  peaks: Float32Array
  duration: number
}

export type AudioJob = {
  file: File
  start: number
  end: number
  mode: EditMode
  fadeIn: boolean
  fadeOut: boolean
  format: OutputFormat
}
