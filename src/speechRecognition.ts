type SpeechResult = { transcript: string; confidence: number }
type RecognitionAlternative = { transcript: string; confidence: number }
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal?: boolean }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type RecognitionError = { error: string }

type RecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionError) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => RecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
}

export function createSpeechRecognition(
  language: string,
  onResult: (result: SpeechResult) => void,
  onError: (message: string) => void,
) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Recognition) throw new Error('Speech recognition is not supported in this browser. Try Chrome or Edge.')

  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = language
  recognition.onresult = (event) => {
    let transcript = ''
    let confidenceTotal = 0
    let confidenceCount = 0
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index]
      const alternative = result?.[0]
      if (!alternative) continue
      transcript += `${alternative.transcript} `
      if (result?.isFinal && alternative.confidence > 0) {
        confidenceTotal += alternative.confidence
        confidenceCount += 1
      }
    }
    onResult({
      transcript: transcript.trim(),
      confidence: confidenceCount ? confidenceTotal / confidenceCount : 0,
    })
  }
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') onError(`Speech recognition: ${event.error}.`)
  }

  return recognition
}
