import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  browserEncoderFor,
  buildWaveform,
  createProcessedBuffer,
  decodeAudioFile,
  encodeWav,
  encodeWithBrowserCodec,
  fileExtension,
  formatTime,
  getAudioContext,
  MIN_SELECTION,
  parseTime,
} from './services/audioProcessor'
import { LocalFfmpegProcessor } from './services/ffmpegProcessor'
import type { EditMode, OutputFormat, WaveformData } from './types'

const audioOutputOptions: Array<{ value: OutputFormat; label: string; detail: string }> = [
  { value: 'wav', label: 'WAV', detail: 'Uncompressed' },
  { value: 'mp3', label: 'MP3', detail: 'Browser codec' },
  { value: 'm4a', label: 'M4A / AAC', detail: 'Browser codec' },
  { value: 'flac', label: 'FLAC', detail: 'Browser codec' },
  { value: 'ogg', label: 'OGG / Opus', detail: 'Browser codec' },
]

const videoOutputOptions: Array<{ value: OutputFormat; label: string; detail: string }> = [
  { value: 'mp4', label: 'MP4', detail: 'H.264 + AAC' },
  { value: 'webm', label: 'WebM', detail: 'VP9 + Opus' },
]

type IconName = 'upload' | 'play' | 'pause' | 'spark' | 'download' | 'plus' | 'minus' | 'undo' | 'shield' | 'chevron' | 'x' | 'wave' | 'video' | 'check'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<IconName, React.ReactNode> = {
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
    spark: <><path d="m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Z" /><path d="m19 16 .5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5L19 16Z" /></>,
    download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    minus: <path d="M5 12h14" />,
    undo: <><path d="M9 7 4 12l5 5" /><path d="M4 12h10a6 6 0 0 1 6 6" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    x: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    wave: <><path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4" /></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  }
  return <svg {...common}>{paths[name]}</svg>
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function makeFileLabel(file: File) {
  const size = file.size / 1024 / 1024
  return `${file.name} · ${size < 1 ? `${Math.round(file.size / 1024)} KB` : `${size.toFixed(1)} MB`}`
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name)
}

function loadVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const value = video.duration
      video.removeAttribute('src')
      video.load()
      if (Number.isFinite(value)) resolve(value)
      else reject(new Error('The video duration could not be read.'))
    }
    video.onerror = () => reject(new Error('This browser could not read the video metadata.'))
    video.src = url
  })
}

function WaveformEditor({
  data,
  start,
  end,
  playhead,
  zoom,
  mode,
  onSelectionChange,
  onPlayheadChange,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: {
  data: WaveformData | null
  start: number
  end: number
  playhead: number
  zoom: number
  mode: EditMode
  onSelectionChange: (start: number, end: number) => void
  onPlayheadChange: (time: number) => void
  onScrub?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const duration = data?.duration ?? 0

  const visibleWindow = useMemo(() => {
    if (!duration) return { start: 0, end: 1 }
    const span = duration / zoom
    if (span >= duration) return { start: 0, end: duration }
    const center = (start + end) / 2
    const windowStart = clamp(center - span / 2, 0, duration - span)
    return { start: windowStart, end: windowStart + span }
  }, [duration, end, start, zoom])

  const timeToX = useCallback((time: number, width: number) => {
    return ((time - visibleWindow.start) / Math.max(0.001, visibleWindow.end - visibleWindow.start)) * width
  }, [visibleWindow])

  const xToTime = useCallback((x: number, width: number) => {
    const ratio = clamp(x / Math.max(1, width), 0, 1)
    return clamp(visibleWindow.start + ratio * (visibleWindow.end - visibleWindow.start), 0, duration)
  }, [duration, visibleWindow])

  const handlePointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!data || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const width = rect.width
    const time = xToTime(x, width)
    const startX = timeToX(start, width)
    const endX = timeToX(end, width)

    if (event.type === 'pointerdown') {
      const threshold = Math.max(16, width * 0.018)
      if (Math.abs(x - startX) <= threshold) {
        setDragging('start')
        onScrubStart?.()
        onScrub?.(start)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      if (Math.abs(x - endX) <= threshold) {
        setDragging('end')
        onScrubStart?.()
        onScrub?.(end)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      onScrubStart?.()
      onPlayheadChange(time)
      onScrubEnd?.()
      return
    }

    if (dragging === 'start') {
      const nextStart = clamp(time, 0, end - MIN_SELECTION)
      onSelectionChange(nextStart, end)
      onScrub?.(nextStart)
    }
    if (dragging === 'end') {
      const nextEnd = clamp(time, start + MIN_SELECTION, duration)
      onSelectionChange(start, nextEnd)
      onScrub?.(nextEnd)
    }
  }, [data, dragging, duration, end, onPlayheadChange, onScrub, onScrubEnd, onScrubStart, onSelectionChange, start, timeToX, xToTime])

  useEffect(() => {
    const release = () => {
      setDragging(null)
      onScrubEnd?.()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [onScrubEnd])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return
    const rect = root.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.floor(214 * dpr)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const width = rect.width
    const height = 214
    context.clearRect(0, 0, width, height)

    context.fillStyle = '#12251e'
    context.fillRect(0, 0, width, height)

    for (let line = 1; line < 6; line += 1) {
      context.strokeStyle = line === 3 ? 'rgba(219, 241, 224, .16)' : 'rgba(219, 241, 224, .07)'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(0, (height / 6) * line)
      context.lineTo(width, (height / 6) * line)
      context.stroke()
    }

    if (!data) {
      context.fillStyle = 'rgba(219, 241, 224, .45)'
      context.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.textAlign = 'center'
      context.fillText('DROP AUDIO TO BEGIN', width / 2, height / 2 + 4)
      return
    }

    const selectionLeft = clamp(timeToX(start, width), 0, width)
    const selectionRight = clamp(timeToX(end, width), 0, width)
    const selectionColor = mode === 'keep' ? 'rgba(204, 231, 106, .18)' : 'rgba(255, 124, 82, .2)'
    context.fillStyle = selectionColor
    context.fillRect(selectionLeft, 0, Math.max(0, selectionRight - selectionLeft), height)

    const visibleStartIndex = Math.floor((visibleWindow.start / duration) * data.peaks.length)
    const visibleEndIndex = Math.ceil((visibleWindow.end / duration) * data.peaks.length)
    const visibleCount = Math.max(1, visibleEndIndex - visibleStartIndex)
    const center = height / 2
    context.strokeStyle = '#dbeed8'
    context.lineWidth = 1.4
    context.beginPath()
    for (let x = 0; x < width; x += 1) {
      const index = Math.min(data.peaks.length - 1, visibleStartIndex + Math.floor((x / width) * visibleCount))
      const amplitude = data.peaks[index] ?? 0
      const bar = Math.max(2, amplitude * 88)
      context.moveTo(x + 0.5, center - bar)
      context.lineTo(x + 0.5, center + bar)
    }
    context.stroke()

    context.fillStyle = mode === 'keep' ? '#cce76a' : '#ff7c52'
    context.fillRect(selectionLeft, 0, 3, height)
    context.fillRect(selectionRight - 3, 0, 3, height)

    if (playhead >= visibleWindow.start && playhead <= visibleWindow.end) {
      const playheadX = timeToX(playhead, width)
      context.strokeStyle = '#fffaf0'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(playheadX, 0)
      context.lineTo(playheadX, height)
      context.stroke()
      context.fillStyle = '#fffaf0'
      context.beginPath()
      context.arc(playheadX, 13, 4, 0, Math.PI * 2)
      context.fill()
    }
  }, [data, duration, end, mode, playhead, start, timeToX, visibleWindow])

  const handleStyle = (time: number): CSSProperties => ({ left: `${clamp(timeToX(time, 1000) / 10, 0, 100)}%` })

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, handle: 'start' | 'end') => {
    const step = event.shiftKey ? 1 : 0.1
    let delta = 0
    if (event.key === 'ArrowLeft' || event.key === '-') delta = -step
    if (event.key === 'ArrowRight' || event.key === '+') delta = step
    if (!delta) return
    event.preventDefault()
    onScrubStart?.()
    if (handle === 'start') {
      const nextStart = clamp(start + delta, 0, end - MIN_SELECTION)
      onSelectionChange(nextStart, end)
      onScrub?.(nextStart)
    } else {
      const nextEnd = clamp(end + delta, start + MIN_SELECTION, duration)
      onSelectionChange(start, nextEnd)
      onScrub?.(nextEnd)
    }
    onScrubEnd?.()
  }

  return (
    <div className="waveform-shell" ref={rootRef} onPointerMove={handlePointer}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        onPointerDown={handlePointer}
        aria-label="Media timeline. Click or drag to preview a frame. Drag the handles to set the selection."
      />
      {data && <>
        <button
          className={`wave-handle wave-handle-start ${dragging === 'start' ? 'is-dragging' : ''}`}
          style={handleStyle(start)}
          onPointerDown={(event) => { event.stopPropagation(); setDragging('start'); onScrubStart?.(); onScrub?.(start); event.currentTarget.setPointerCapture(event.pointerId) }}
          onKeyDown={(event) => handleKeyDown(event, 'start')}
          aria-valuenow={start}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuetext={formatTime(start)}
          aria-label={`Start time ${formatTime(start)}`}
        ><span /></button>
        <button
          className={`wave-handle wave-handle-end ${dragging === 'end' ? 'is-dragging' : ''}`}
          style={handleStyle(end)}
          onPointerDown={(event) => { event.stopPropagation(); setDragging('end'); onScrubStart?.(); onScrub?.(end); event.currentTarget.setPointerCapture(event.pointerId) }}
          onKeyDown={(event) => handleKeyDown(event, 'end')}
          aria-valuenow={end}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuetext={formatTime(end)}
          aria-label={`End time ${formatTime(end)}`}
        ><span /></button>
      </>}
      <div className="waveform-axis" aria-hidden="true">
        <span>{formatTime(visibleWindow.start)}</span>
        <span>{formatTime(visibleWindow.end)}</span>
      </div>
    </div>
  )
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [mediaKind, setMediaKind] = useState<'audio' | 'video'>('audio')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [startInput, setStartInput] = useState('00:00')
  const [endInput, setEndInput] = useState('00:00')
  const [playhead, setPlayhead] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [mode, setMode] = useState<EditMode>('keep')
  const [fadeIn, setFadeIn] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const [format, setFormat] = useState<OutputFormat>('wav')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [status, setStatus] = useState('Ready when you are.')
  const [error, setError] = useState('')
  const [exported, setExported] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaUrlRef = useRef<string | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const ffmpegRef = useRef<LocalFfmpegProcessor | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const frameRef = useRef<number | null>(null)
  const scrubFrameRef = useRef<number | null>(null)
  const pendingScrubTimeRef = useRef<number | null>(null)
  const isScrubbingRef = useRef(false)
  const exportAbortRef = useRef<AbortController | null>(null)
  const playbackElapsedRef = useRef(0)
  const playbackStartedAtRef = useRef(0)
  const playbackBufferDurationRef = useRef(0)

  const duration = waveform?.duration ?? 0
  const selectionDuration = Math.max(0, end - start)
  const outputOptions = mediaKind === 'video' ? videoOutputOptions : audioOutputOptions
  const selectedFormat = outputOptions.find((option) => option.value === format) ?? outputOptions[0]
  const codec = mediaKind === 'video' ? null : format === 'wav' ? 'audio/wav' : browserEncoderFor(format)
  const isCodecAvailable = mediaKind === 'video' || format === 'wav' || !!codec

  const cancelScheduledScrub = useCallback(() => {
    if (scrubFrameRef.current !== null) cancelAnimationFrame(scrubFrameRef.current)
    scrubFrameRef.current = null
    pendingScrubTimeRef.current = null
  }, [])

  const stopPlayback = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try { sourceRef.current.stop() } catch { /* source already ended */ }
    }
    sourceRef.current = null
    if (videoRef.current) videoRef.current.pause()
    setIsPlaying(false)
  }, [])

  useEffect(() => () => {
    stopPlayback()
    cancelScheduledScrub()
    const context = contextRef.current
    contextRef.current = null
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
    ffmpegRef.current?.cancel()
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current)
  }, [cancelScheduledScrub, stopPlayback])

  const setSelection = useCallback((nextStart: number, nextEnd: number) => {
    const safeStart = clamp(nextStart, 0, Math.max(0, duration - MIN_SELECTION))
    const safeEnd = clamp(nextEnd, safeStart + MIN_SELECTION, duration || MIN_SELECTION)
    stopPlayback()
    setStart(safeStart)
    setEnd(safeEnd)
    setStartInput(formatTime(safeStart))
    setEndInput(formatTime(safeEnd))
    setPlayhead(safeStart)
    setExported(false)
  }, [duration, stopPlayback])

  const loadFile = useCallback(async (nextFile: File) => {
    const video = isVideoFile(nextFile)
    const audio = nextFile.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(nextFile.name)
    if (!audio && !video) {
      setError('That file does not look like audio or video. Try MP3, WAV, MP4, WebM, M4A, FLAC, OGG, or Opus.')
      return
    }

    cancelScheduledScrub()
    stopPlayback()
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current)
    mediaUrlRef.current = null
    setMediaUrl(null)
    setError('')
    setExported(false)
    setIsBusy(true)
    setStatus(video ? 'Reading video locally…' : 'Reading audio locally…')

    let nextUrl: string | null = null
    try {
      let decoded: AudioBuffer | null = null
      let nextDuration = 0

      if (video) {
        nextUrl = URL.createObjectURL(nextFile)
        nextDuration = await loadVideoDuration(nextUrl)
        try {
          const context = contextRef.current ?? getAudioContext()
          contextRef.current = context
          decoded = await decodeAudioFile(nextFile, context)
        } catch {
          // Some browser/container combinations expose video playback but not AudioContext decoding.
        }
      } else {
        const context = contextRef.current ?? getAudioContext()
        contextRef.current = context
        decoded = await decodeAudioFile(nextFile, context)
        nextDuration = decoded.duration
      }

      const peaks = decoded ? buildWaveform(decoded) : new Float32Array(Math.max(1, Math.ceil(nextDuration * 60)))
      mediaUrlRef.current = nextUrl
      setMediaUrl(nextUrl)
      setMediaKind(video ? 'video' : 'audio')
      setFile(nextFile)
      setAudioBuffer(decoded)
      setWaveform({ peaks, duration: nextDuration })
      setStart(0)
      setEnd(nextDuration)
      setStartInput(formatTime(0))
      setEndInput(formatTime(nextDuration))
      setPlayhead(0)
      setZoom(1)
      setFormat(video ? 'mp4' : 'wav')
      setStatus(video
        ? decoded ? 'Video is loaded and ready to trim.' : 'Video is ready. Waveform preview is unavailable for this container.'
        : 'Audio is loaded and ready to trim.')
    } catch (loadError) {
      if (nextUrl) URL.revokeObjectURL(nextUrl)
      setError(loadError instanceof Error ? loadError.message : 'Could not decode that media file in this browser.')
      setStatus('Could not load this file.')
    } finally {
      setIsBusy(false)
    }
  }, [cancelScheduledScrub, stopPlayback])

  const commitTimeInput = (which: 'start' | 'end') => {
    const parsed = parseTime(which === 'start' ? startInput : endInput)
    if (!Number.isFinite(parsed)) {
      setStartInput(formatTime(start))
      setEndInput(formatTime(end))
      return
    }
    if (which === 'start') {
      const nextStart = clamp(parsed, 0, end - MIN_SELECTION)
      setSelection(nextStart, end)
      handlePlayheadChange(nextStart)
    } else {
      const nextEnd = clamp(parsed, start + MIN_SELECTION, duration)
      setSelection(start, nextEnd)
      handlePlayheadChange(nextEnd)
    }
  }

  const animatePlayback = useCallback(() => {
    const context = contextRef.current
    if (!context || !sourceRef.current) return
    const elapsed = Math.min(playbackBufferDurationRef.current, playbackElapsedRef.current + (context.currentTime - playbackStartedAtRef.current))
    const previewStart = start
    const previewEnd = end
    const originalPosition = mode === 'keep'
      ? previewStart + elapsed
      : elapsed <= previewStart ? elapsed : previewEnd + (elapsed - previewStart)
    setPlayhead(clamp(originalPosition, 0, duration))
    if (elapsed < playbackBufferDurationRef.current && sourceRef.current) frameRef.current = requestAnimationFrame(animatePlayback)
  }, [duration, end, mode, start])

  const startPlayback = async (offset = 0) => {
    if (!audioBuffer) return
    stopPlayback()
    const context = contextRef.current ?? getAudioContext()
    contextRef.current = context
    if (context.state === 'suspended') await context.resume()
    const processed = createProcessedBuffer(audioBuffer, { start, end, mode, fadeIn, fadeOut })
    const safeOffset = clamp(offset, 0, Math.max(0, processed.duration - 0.01))
    const source = context.createBufferSource()
    source.buffer = processed
    source.connect(context.destination)
    playbackElapsedRef.current = safeOffset
    playbackBufferDurationRef.current = processed.duration
    playbackStartedAtRef.current = context.currentTime
    source.onended = () => {
      if (sourceRef.current !== source) return
      playbackElapsedRef.current = 0
      setPlayhead(mode === 'keep' ? start : 0)
      setIsPlaying(false)
      sourceRef.current = null
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    sourceRef.current = source
    source.start(0, safeOffset)
    setIsPlaying(true)
    frameRef.current = requestAnimationFrame(animatePlayback)
  }

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    const current = video.currentTime

    if (video.paused || isScrubbingRef.current) {
      setPlayhead(clamp(current, 0, duration))
      return
    }

    if (mode === 'keep' && current >= end - 0.03) {
      video.pause()
      video.currentTime = start
      setPlayhead(start)
      setIsPlaying(false)
      return
    }

    if (mode === 'remove' && current >= start && current < end - 0.03) {
      video.currentTime = end
      return
    }

    setPlayhead(clamp(current, 0, duration))
  }

  const handleVideoEnded = () => {
    isScrubbingRef.current = false
    setIsPlaying(false)
    setPlayhead(mode === 'keep' ? start : 0)
  }

  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true
    if (videoRef.current) videoRef.current.pause()
    setIsPlaying(false)
  }, [])

  const handleScrubEnd = useCallback(() => {
    isScrubbingRef.current = false
  }, [])

  const handleScrub = useCallback((time: number) => {
    const safeTime = clamp(time, 0, duration)
    setPlayhead(safeTime)
    if (mediaKind !== 'video' || !videoRef.current) return

    pendingScrubTimeRef.current = safeTime
    if (scrubFrameRef.current !== null) return
    scrubFrameRef.current = requestAnimationFrame(() => {
      scrubFrameRef.current = null
      const nextTime = pendingScrubTimeRef.current
      pendingScrubTimeRef.current = null
      const video = videoRef.current
      if (!video || nextTime === null) return
      video.currentTime = nextTime
    })
  }, [duration, mediaKind])

  const handlePlayheadChange = useCallback((time: number) => {
    const safeTime = clamp(time, 0, duration)
    cancelScheduledScrub()
    setPlayhead(safeTime)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = safeTime
      setIsPlaying(false)
    }
  }, [cancelScheduledScrub, duration])

  const togglePlayback = async () => {
    if (mediaKind === 'video') {
      const video = videoRef.current
      if (!video) return
      cancelScheduledScrub()
      if (isPlaying) {
        video.pause()
        setIsPlaying(false)
        return
      }

      const nextPosition = mode === 'keep'
        ? playhead >= end || playhead < start ? start : playhead
        : playhead >= start && playhead < end ? end : playhead
      video.currentTime = clamp(nextPosition, 0, duration)
      try {
        await video.play()
        setIsPlaying(true)
      } catch {
        setError('Video playback was blocked by the browser. Press play again to allow local preview.')
      }
      return
    }

    if (isPlaying) {
      const context = contextRef.current
      if (context) playbackElapsedRef.current = Math.min(playbackBufferDurationRef.current, playbackElapsedRef.current + context.currentTime - playbackStartedAtRef.current)
      stopPlayback()
      return
    }
    await startPlayback(playbackElapsedRef.current)
  }

  const handleNudge = (which: 'start' | 'end', amount: number) => {
    if (which === 'start') {
      const nextStart = clamp(start + amount, 0, end - MIN_SELECTION)
      setSelection(nextStart, end)
      handlePlayheadChange(nextStart)
    } else {
      const nextEnd = clamp(end + amount, start + MIN_SELECTION, duration)
      setSelection(start, nextEnd)
      handlePlayheadChange(nextEnd)
    }
  }

  const handleExport = async () => {
    if ((!audioBuffer && mediaKind === 'audio') || !file || isBusy) return
    setError('')
    setExported(false)
    setIsBusy(true)
    setStatus('Rendering your edit on this device…')
    const exportController = new AbortController()
    exportAbortRef.current = exportController

    try {
      let blob: Blob
      if (mediaKind === 'video') {
        setStatus('Loading the local video encoder…')
        const processor = ffmpegRef.current ?? new LocalFfmpegProcessor()
        ffmpegRef.current = processor
        if (mode === 'remove' && selectionDuration >= duration - 0.05) throw new Error('Removing the entire video would create an empty file. Keep a small region or switch to Keep selection.')
        blob = await processor.processVideo(file, { start, end, mode, fadeIn, fadeOut }, format as 'mp4' | 'webm', duration, (progress) => {
          setStatus(`Encoding video locally… ${Math.round(progress * 100)}%`)
        }, exportController.signal)
      } else if (codec) {
        const processed = createProcessedBuffer(audioBuffer!, { start, end, mode, fadeIn, fadeOut })
        if (format === 'wav') blob = encodeWav(processed)
        else blob = await encodeWithBrowserCodec(processed, codec)
      } else if (format === 'wav') {
        const processed = createProcessedBuffer(audioBuffer!, { start, end, mode, fadeIn, fadeOut })
        blob = encodeWav(processed)
      } else {
        throw new Error(`${selectedFormat.label} is not available in this browser. Choose WAV, or add a self-hosted FFmpeg WASM bundle for more codecs.`)
      }

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${file?.name.replace(/\.[^/.]+$/, '') || 'localcut-export'}.${fileExtension(format)}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExported(true)
      setStatus('Export complete. Your file stayed on this device.')
    } catch (exportError) {
      if (exportController.signal.aborted) {
        setError('')
        setStatus('Export cancelled. Your source file is still here.')
        return
      }
      setError(exportError instanceof Error ? exportError.message : 'Export failed. Try WAV instead.')
      setStatus('Export needs your attention.')
    } finally {
      exportAbortRef.current = null
      setIsBusy(false)
    }
  }

  const cancelExport = () => {
    exportAbortRef.current?.abort()
    ffmpegRef.current?.cancel()
  }

  const resetSelection = () => {
    if (!duration) return
    stopPlayback()
    setSelection(0, duration)
    handlePlayheadChange(0)
    setStatus('Selection reset to the full track.')
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) void loadFile(dropped)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to editor</a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="LocalCut home"><span className="brand-mark"><Icon name="wave" size={19} /></span><span>local<span>cut</span></span></a>
        <div className="privacy-chip"><Icon name="shield" size={16} /><span>Your audio never leaves this device</span></div>
      </header>

      <main id="main-content" className="workspace">
        <section className="intro-row">
          <div className="intro-heading">
            <p className="eyebrow"><span className="eyebrow-index">01</span> LOCALCUT / MEDIA EDITOR <span className="eyebrow-dot" /></p>
            <h1>Trim.<br /><em>Keep it local.</em></h1>
          </div>
          <div className="intro-side">
            <p className="intro-copy">Quick, private edits for audio and video. Your file stays in this browser tab from open to export.</p>
            <div className="workflow-rail" aria-label="Editing workflow">
              <span><b>01</b> OPEN</span><i aria-hidden="true" /><span><b>02</b> CUT</span><i aria-hidden="true" /><span><b>03</b> EXPORT</span>
            </div>
          </div>
        </section>

        <section className="editor-card" aria-label={mediaKind === 'video' ? 'Video editor' : 'Audio editor'}>
          {!file ? (
            <div
              className={`drop-zone ${isDraggingFile ? 'is-dragging' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={onDrop}
            >
              <div className="drop-main">
                <div className="drop-icon"><Icon name="upload" size={28} /></div>
                <div className="drop-copy">
                  <p className="drop-kicker">START WITH A LOCAL FILE</p>
                  <h2>Drop audio or video here</h2>
                  <p>Preview, select a region, and export without an upload.</p>
                  <div className="drop-actions">
                    <button className="button button-dark" onClick={() => inputRef.current?.click()}><Icon name="upload" size={17} /> Choose media</button>
                    <span className="drop-note"><Icon name="shield" size={14} /> No upload · no account</span>
                  </div>
                </div>
              </div>
              <div className="drop-meta" aria-label="Local processing details">
                <div><span>INPUT</span><strong>Audio + video</strong></div>
                <div><span>OUTPUT</span><strong>WAV · MP3 · MP4</strong></div>
                <div><span>STORAGE</span><strong>This device only</strong></div>
              </div>
            </div>
          ) : (
            <>
              <div className="file-strip">
                <div className="file-detail"><span className="file-icon"><Icon name={mediaKind === 'video' ? 'video' : 'wave'} size={18} /></span><div><strong>{file.name}</strong><span className="file-meta-line"><b className="media-type-tag">{mediaKind}</b><span>{makeFileLabel(file).split(' · ')[1]} · {formatTime(duration, true)} duration</span></span></div></div>
                <div className="file-actions">
                  <button className="text-button file-replace-button" onClick={() => inputRef.current?.click()}><Icon name="upload" size={14} /><span>Change file</span></button>
                  <button className="icon-button" onClick={() => { stopPlayback(); if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current); mediaUrlRef.current = null; setMediaUrl(null); setMediaKind('audio'); setFile(null); setAudioBuffer(null); setWaveform(null); setFormat('wav'); setStatus('Ready when you are.'); setError('') }} aria-label="Remove file" title="Remove file"><Icon name="x" size={18} /></button>
                </div>
              </div>

              {mediaKind === 'video' && mediaUrl && <div className="video-preview"><video ref={videoRef} src={mediaUrl} playsInline preload="metadata" onTimeUpdate={handleVideoTimeUpdate} onEnded={handleVideoEnded} aria-label="Video preview" /><div className="video-preview-label"><Icon name="video" size={14} /> Video preview · selection-aware playback</div></div>}
              <section className="timeline-stage" aria-label="Media timeline">
                <div className="waveform-header">
                  <div className="timeline-heading"><div className="timeline-title-line"><span className="section-kicker">{mediaKind === 'video' ? 'MEDIA TIMELINE' : 'WAVEFORM'}</span><span className="timeline-live-badge">LIVE PREVIEW</span></div><strong>{mode === 'keep' ? 'Select the part to keep' : 'Select the part to remove'}</strong><span className="waveform-hint">{mediaKind === 'video' ? 'Drag the timeline to preview a frame' : 'Drag the handles or use the keyboard'}</span></div>
                  <div className="zoom-control"><span>Zoom</span><button onClick={() => setZoom((value) => clamp(value - 0.5, 1, 4))} aria-label="Zoom out" disabled={zoom <= 1}><Icon name="minus" size={15} /></button><span className="zoom-value">{zoom.toFixed(1)}×</span><button onClick={() => setZoom((value) => clamp(value + 0.5, 1, 4))} aria-label="Zoom in" disabled={zoom >= 4}><Icon name="plus" size={15} /></button></div>
                </div>
                <WaveformEditor data={waveform} start={start} end={end} playhead={playhead} zoom={zoom} mode={mode} onSelectionChange={setSelection} onPlayheadChange={handlePlayheadChange} onScrub={handleScrub} onScrubStart={handleScrubStart} onScrubEnd={handleScrubEnd} />
                <div className="timeline-footer"><span><span className={`timeline-status-dot ${mode}`} />{mode === 'keep' ? 'Keeping selected region' : 'Removing selected region'}</span><span>{formatTime(selectionDuration, true)} selected</span></div>
              </section>

              <section className="selection-panel" aria-label="Selection controls">
                <div className="selection-heading"><div><span className="section-kicker">SELECTION RANGE</span><p>Set exact in and out points, then preview the result.</p></div><div className="selection-length"><span>EDIT LENGTH</span><strong>{formatTime(selectionDuration, true)}</strong></div></div>
                <div className="selection-row">
                  <TimeControl label="Start" value={startInput} onChange={setStartInput} onCommit={() => commitTimeInput('start')} onNudge={(amount) => handleNudge('start', amount)} />
                  <div className="selection-summary"><span className={`mode-dot ${mode}`} /><span>{mode === 'keep' ? 'Keeping' : 'Removing'} {formatTime(selectionDuration)}</span></div>
                  <TimeControl label="End" value={endInput} onChange={setEndInput} onCommit={() => commitTimeInput('end')} onNudge={(amount) => handleNudge('end', amount)} />
                </div>

                <div className="control-divider" />
                <div className="transport-row">
                  <button className="transport-main" onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause preview' : 'Preview selected region'}><span className="transport-icon"><Icon name={isPlaying ? 'pause' : 'play'} size={16} /></span><span>{isPlaying ? 'Pause preview' : mediaKind === 'video' ? 'Preview video' : 'Preview selection'}</span></button>
                  <div className="position-readout"><span>POSITION</span><strong>{formatTime(playhead, true)}</strong><span className="position-divider">/</span><span>{formatTime(duration, true)}</span></div>
                  <button className="text-button" onClick={resetSelection}><Icon name="undo" size={15} /> Reset selection</button>
                </div>
              </section>
            </>
          )}

          {file && <div className="settings-grid">
            <div className="setting-block mode-block"><div className="setting-label"><span>EDIT MODE</span><span className="info-dot" title="Keep preserves the selection. Remove cuts it out.">i</span></div><div className="segmented-control"><button className={mode === 'keep' ? 'is-active' : ''} onClick={() => { setMode('keep'); stopPlayback() }}><span className="segment-indicator keep" />Keep selection</button><button className={mode === 'remove' ? 'is-active remove-active' : ''} onClick={() => { setMode('remove'); stopPlayback() }}><span className="segment-indicator remove" />Remove selection</button></div></div>
            <div className="setting-block"><div className="setting-label"><span>FINISHING</span><span className="setting-subtle">optional</span></div><div className="switch-row"><Switch label="Fade in" checked={fadeIn} onChange={setFadeIn} /><Switch label="Fade out" checked={fadeOut} onChange={setFadeOut} /></div></div>
            <div className="setting-block format-block"><div className="setting-label"><span>OUTPUT FORMAT</span>{format !== 'wav' && !isCodecAvailable && <span className="setting-warning">browser codec unavailable</span>}</div><label className="format-select"><select aria-label="Output format" value={format} onChange={(event) => setFormat(event.target.value as OutputFormat)}>{outputOptions.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select><Icon name="chevron" size={16} /></label></div>
          </div>}

          {(error || status) && <div className={`status-line ${error ? 'has-error' : ''} ${exported ? 'is-success' : ''}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}><span className="status-pip" />{error || status}</div>}

          {file && <div className="export-bar"><div className="export-copy"><span className="export-kicker"><Icon name="shield" size={14} /> LOCAL EXPORT</span><strong>{isCodecAvailable ? `Ready to create ${selectedFormat.label}` : 'Choose a browser-supported format'}</strong><span>Nothing is uploaded. The final file is assembled in memory.</span></div><div className="export-actions">{isBusy && mediaKind === 'video' && <button className="cancel-button" onClick={cancelExport}>Cancel</button>}<button className="button button-export" onClick={() => void handleExport()} disabled={isBusy}><span>{isBusy ? 'Working…' : mediaKind === 'video' ? 'Trim Video' : 'Trim Audio'}</span><Icon name={isBusy ? 'spark' : 'download'} size={18} /></button></div></div>}
        </section>

        <footer className="footer-note"><span><span className="footer-mark" aria-hidden="true" /> Built for quick edits, not complicated timelines.</span><span>Works offline after the first load <span className="online-dot" /></span></footer>
      </main>

      <input ref={inputRef} className="sr-only" type="file" accept="audio/*,video/*,.mp3,.wav,.mp4,.webm,.mov,.m4v,.m4a,.aac,.flac,.ogg,.opus" onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void loadFile(picked); event.target.value = '' }} />
    </div>
  )
}

function TimeControl({ label, value, onChange, onCommit, onNudge }: { label: string; value: string; onChange: (value: string) => void; onCommit: () => void; onNudge: (amount: number) => void }) {
  return <div className="time-control"><label htmlFor={`time-${label.toLowerCase()}`}>{label}</label><div className="time-input-wrap"><input id={`time-${label.toLowerCase()}`} name={`time-${label.toLowerCase()}`} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onCommit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onCommit() } }} /><span>sec</span></div><div className="nudge-controls"><button onClick={() => onNudge(-0.1)} aria-label={`Move ${label} earlier`}><Icon name="minus" size={13} /></button><button onClick={() => onNudge(0.1)} aria-label={`Move ${label} later`}><Icon name="plus" size={13} /></button></div></div>
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" className="switch-label" aria-pressed={checked} aria-label={`${label} ${checked ? 'on' : 'off'}`} onClick={() => onChange(!checked)}><span>{label}</span><span className={`switch ${checked ? 'is-on' : ''}`} aria-hidden="true"><span /></span></button>
}
