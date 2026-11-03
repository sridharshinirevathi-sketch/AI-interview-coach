import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm'
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

type Point = { x: number; y: number }
type EyeContactTracker = { stop: () => void }

function isLookingAtScreen(landmarks: Point[]) {
  const eyes = [
    { left: 33, right: 133, top: 159, bottom: 145, iris: 468 },
    { left: 362, right: 263, top: 386, bottom: 374, iris: 473 },
  ]

  return eyes.every(({ left, right, top, bottom, iris }) => {
    const start = landmarks[left]
    const end = landmarks[right]
    const upper = landmarks[top]
    const lower = landmarks[bottom]
    const pupil = landmarks[iris]
    if (!start || !end || !upper || !lower || !pupil) return false

    const eyeLeft = Math.min(start.x, end.x)
    const eyeWidth = Math.abs(end.x - start.x)
    if (Math.abs(eyeWidth) < 0.001) return false

    const horizontal = (pupil.x - eyeLeft) / eyeWidth
    const eyeTop = Math.min(upper.y, lower.y)
    const eyeHeight = Math.abs(lower.y - upper.y)
    if (eyeHeight < 0.001) return false
    const vertical = (pupil.y - eyeTop) / eyeHeight
    return horizontal >= 0.3 && horizontal <= 0.7 && vertical >= 0.15 && vertical <= 0.85
  })
}

export async function startEyeContactTracking(
  video: HTMLVideoElement,
  onScore: (score: number) => void,
): Promise<EyeContactTracker> {
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot)
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
  })

  let active = true
  let frameId = 0
  let lastSample = 0
  let samples = 0
  let lookingSamples = 0

  const sample = (now: number) => {
    if (!active) return
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastSample >= 250) {
      lastSample = now
      const face = landmarker.detectForVideo(video, now).faceLandmarks[0]
      if (face) {
        samples += 1
        if (isLookingAtScreen(face)) lookingSamples += 1
        onScore(Math.round((lookingSamples / samples) * 100))
      }
    }
    frameId = requestAnimationFrame(sample)
  }

  frameId = requestAnimationFrame(sample)
  return {
    stop: () => {
      active = false
      cancelAnimationFrame(frameId)
      landmarker.close()
    },
  }
}
