// Whether on-device speech recognition can run, and what the learner must do first.

export function getAsrReadiness(status) {
  if (!status) return { ready: false, missing: 'status', message: 'Checking speech recognition…' }
  if (!status.platformSupported) {
    return { ready: false, missing: 'platform', message: status.runtimeError || 'speech.cpp has no pinned build for this platform.' }
  }
  if (!status.runtimeReady) {
    return {
      ready: false,
      missing: 'runtime',
      message: status.runtimeFound && status.runtimeError ? status.runtimeError : 'Install the speech.cpp runtime to enable speech recognition.'
    }
  }
  if (!status.modelInstalled) return { ready: false, missing: 'model', message: 'Download Haas-ja-v1.0 to enable speech recognition.' }
  return { ready: true, missing: null, message: 'Haas-ja-v1.0 is ready for on-device Japanese speech recognition.' }
}
