import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { GoogleGenAI } from '@google/genai'

const app = express()
const port = process.env.PORT || 3001
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash'

app.use(cors())
app.use(express.json({ limit: '20mb' }))

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, geminiConfigured: Boolean(ai) })
})

app.post('/api/analyze', async (request, response) => {
  if (!ai) {
    return response.status(500).json({ error: 'GEMINI_API_KEY is missing in .env' })
  }

  const { type = 'resume', text = '', resumeText = '', question = '', video, file } = request.body
  if (!text && !file?.data) {
    return response.status(400).json({ error: 'text or file is required' })
  }

  const context = `Candidate resume:\n${resumeText || 'Not provided'}\n\nCurrent question:\n${question || 'Not provided'}\n\nSpoken transcript:\n${text}`
  const prompts = {
    resume: `Analyze the attached resume file for ATS compatibility. Do not reuse a previous score. Calculate a fresh score from this exact file. Return valid JSON only with this shape: {"score": number, "mistakes": string[], "improvements": string[], "keywords": string[]}. If text is available, use it too:\n${text}`,
    intro: `Analyze the candidate's self introduction using the transcript, resume, and attached video when available. Return valid JSON only with this shape: {"score": number, "eyeContact": number, "pronunciation": number, "confidence": number, "wording": number, "feedback": string[], "generatedAnswer": string}. ${context}`,
    interview: `Evaluate the candidate's interview answer using every provided input: transcript, resume, current question, and attached video when available. Generate a concise, specific model answer grounded in the candidate's real experience. Return valid JSON only with this shape: {"score": number, "relevant": boolean, "feedback": string[], "betterAnswerTip": string, "generatedAnswer": string}. ${context}`,
  }

  try {
    const contentParts = [{ text: prompts[type] ?? prompts.resume }]
    if (file?.data && file?.mimeType) {
      contentParts.push({ inlineData: { mimeType: file.mimeType, data: file.data } })
    }
    if (video?.data && video?.mimeType) {
      contentParts.push({ inlineData: { mimeType: video.mimeType, data: video.data } })
    }

    let result
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await ai.models.generateContent({
          model: geminiModel,
          contents: [{ role: 'user', parts: contentParts }],
          config: { responseMimeType: 'application/json' },
        })
        break
      } catch (error) {
        lastError = error
        const status = error?.status
        if (status !== 503 && status !== 429 && error?.code !== 'UND_ERR_CONNECT_TIMEOUT') throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }

    if (!result) throw lastError

    return response.json(JSON.parse(result.text ?? '{}'))
  } catch (error) {
    console.error(error)
    const status = error?.status === 503 || error?.status === 429 ? 503 : 502
    const message = status === 503
      ? 'Gemini is temporarily busy. Please click View score again in a few seconds.'
      : 'Gemini analysis failed. Check that the backend is running and try again.'
    return response.status(status).json({ error: message })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Gemini API server running on port ${port}`)
})
