import type { AudioJob } from '../types'

export const MIN_SELECTION = 0.05

export function getAudioContext(): AudioContext {
  const AudioContextConstructor = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextConstructor) {
    throw new Error('This browser does not support the Web Audio API.')
  }

  return new AudioContextConstructor()
}

export async function decodeAudioFile(file: File, context = getAudioContext()): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer()
  return context.decodeAudioData(bytes.slice(0))
}

export function buildWaveform(audioBuffer: AudioBuffer, sampleCount = 2400): Float32Array {
  const count = Math.min(sampleCount, Math.max(240, Math.ceil(audioBuffer.duration * 80)))
  const peaks = new Float32Array(count)
  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket / count) * length)
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / count) * length))
    let peak = 0

    for (let channel = 0; channel < channels; channel += 1) {
      const data = audioBuffer.getChannelData(channel)
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0))
      }
    }

    peaks[bucket] = peak
  }

  return peaks
}

function copyRange(source: AudioBuffer, start: number, end: number, output: Float32Array[], offset: number) {
  const startFrame = Math.max(0, Math.floor(start * source.sampleRate))
  const endFrame = Math.min(source.length, Math.ceil(end * source.sampleRate))

  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output[channel].set(source.getChannelData(channel).subarray(startFrame, endFrame), offset)
  }

  return endFrame - startFrame
}

export function createProcessedBuffer(source: AudioBuffer, job: Omit<AudioJob, 'file' | 'format'>): AudioBuffer {
  const { start, end, mode, fadeIn, fadeOut } = job
  const sampleRate = source.sampleRate
  const firstLength = Math.max(0, Math.ceil((end - start) * sampleRate))
  const secondLength = mode === 'remove' ? Math.max(0, Math.ceil((source.duration - end) * sampleRate)) : 0
  const outputLength = mode === 'keep' ? firstLength : Math.max(1, firstLength + secondLength)
  const output = new AudioBuffer({
    length: outputLength,
    numberOfChannels: source.numberOfChannels,
    sampleRate,
  })
  const channels = Array.from({ length: source.numberOfChannels }, (_, channel) => output.getChannelData(channel))

  if (mode === 'keep') {
    copyRange(source, start, end, channels, 0)
  } else {
    const copied = copyRange(source, 0, start, channels, 0)
    copyRange(source, end, source.duration, channels, copied)
  }

  const fadeFrames = Math.min(Math.floor(sampleRate * 0.35), Math.floor(outputLength / 2))
  if (fadeIn) {
    for (let frame = 0; frame < fadeFrames; frame += 1) {
      const gain = frame / Math.max(1, fadeFrames)
      for (const channel of channels) channel[frame] *= gain
    }
  }
  if (fadeOut) {
    for (let frame = 0; frame < fadeFrames; frame += 1) {
      const index = outputLength - frame - 1
      const gain = frame / Math.max(1, fadeFrames)
      for (const channel of channels) channel[index] *= gain
    }
  }

  return output
}

export function encodeWav(audioBuffer: AudioBuffer): Blob {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = audioBuffer.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let pointer = 44
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = audioBuffer.getChannelData(channel)[frame] ?? 0
      const clamped = Math.max(-1, Math.min(1, sample))
      view.setInt16(pointer, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      pointer += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export function formatTime(value: number, showHours = false): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = Math.floor(safe % 60)

  if (showHours || hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function parseTime(value: string): number {
  const parts = value.trim().split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return Number.NaN
  if (parts.length === 1) return parts[0] ?? 0
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
}

export function fileExtension(format: string): string {
  return format === 'm4a' ? 'm4a' : format
}

export function browserEncoderFor(format: string): string | null {
  const candidates: Record<string, string[]> = {
    ogg: ['audio/ogg;codecs=opus', 'audio/ogg'],
    m4a: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
    mp3: ['audio/mpeg'],
    flac: ['audio/flac'],
  }
  return (candidates[format] ?? []).find((mime) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) ?? null
}

export async function encodeWithBrowserCodec(audioBuffer: AudioBuffer, mimeType: string): Promise<Blob> {
  const context = getAudioContext()
  const destination = context.createMediaStreamDestination()
  const source = context.createBufferSource()
  source.buffer = audioBuffer
  source.connect(destination)

  return new Promise<Blob>((resolve, reject) => {
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(destination.stream, { mimeType })
    recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data)
    recorder.onerror = () => reject(new Error('Browser audio encoding failed.'))
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.start()
    source.onended = () => recorder.stop()
    source.start()
  }).finally(() => context.close())
}
