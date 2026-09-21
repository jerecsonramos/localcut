/// <reference lib="webworker" />

// Reserved worker entry point for the optional self-hosted FFmpeg adapter.
// Keeping the processing boundary in a worker prevents a future codec bundle
// from moving large work onto the React render thread.
self.onmessage = () => {
  self.postMessage({ type: 'error', message: 'No local FFmpeg WASM bundle has been configured.' })
}
