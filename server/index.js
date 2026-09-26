import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'

const app = express()
const port = process.env.PORT || 3001
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash'

// Get the current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// React frontend build folder
const distPath = path.resolve(__dirname, '../dist')

// Middleware
app.use(cors())
app.use(express.json({ limit: '20mb' }))

// Gemini API configuration
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null

const normalizeText = (value = '') =>
  String(value).replace(/\s+/g, ' ').trim()

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value))

const countMatches = (text, keywords) => {
  const normalized = normalizeText(text).toLowerCase()

  return keywords.filter((keyword) =>
    normalized.includes(keyword.toLowerCase())
  ).length
}

const computeResumeRubric = (text = '', resumeText = '') => {
  const source = normalizeText(`${resumeText} ${text}`)

  if (!source) return 0

  const sections = [
    'experience',
    'skills',
    'education',
    'summary',
    'projects',
  ]

  const sectionScore =
    sections.filter((section) =>
      source.toLowerCase().includes(section)
    ).length * 6

  const metrics =
    /(\d+%|\d+\+|\d+ years|\d+ months|\$\d+|\b\d+\b)/i.test(source)
      ? 15
      : 0

  const actionWords = [
    'led',
    'built',
    'improved',
    'managed',
    'delivered',
    'developed',
    'designed',
    'optimized',
    'launched',
  ]

  const actionScore =
    Math.min(15, countMatches(source, actionWords) * 3)

  const keywordTerms = [
    'react',
    'javascript',
    'typescript',
    'python',
    'sql',
    'node',
    'aws',
    'design',
    'research',
    'project',
    'team',
    'communication',
    'problem',
    'product',
  ]

  const keywordScore =
    Math.min(20, countMatches(source, keywordTerms) * 2)

  const readability =
    source.length > 200 ? 15 : 8

  const bulletScore =
    /[-•*]/.test(source) ? 15 : 8

  const total =
    sectionScore +
    metrics +
    actionScore +
    keywordScore +
    readability +
    bulletScore

  return clamp(Math.round(total), 0, 100)
}

const computeIntroRubric = (text = '', resumeText = '') => {
  const source = normalizeText(`${resumeText} ${text}`)

  if (!source) return 0

  const wordCount = source.split(' ').length

  const lengthScore =
    wordCount >= 60 && wordCount <= 180
      ? 20
      : wordCount > 180
        ? 16
        : 10

  const structureWords = [
    'hello',
    'my name',
    'i am',
    'currently',
    'experience',
    'skills',
    'strengths',
    'thank',
    'excited',
    'interested',
  ]

  const structureScore =
    Math.min(
      20,
      countMatches(source.toLowerCase(), structureWords) * 3
    )

  const confidenceWords = [
    'confident',
    'passionate',
    'excited',
    'strong',
    'focused',
    'motivated',
    'comfortable',
    'able',
    'experience',
  ]

  const confidenceScore =
    Math.min(
      20,
      countMatches(source.toLowerCase(), confidenceWords) * 2
    )

  const relevanceScore =
    resumeText ? 20 : 10

  const clarityScore =
    source.length > 180 ? 20 : 14

  return clamp(
    Math.round(
      lengthScore +
      structureScore +
      confidenceScore +
      relevanceScore +
      clarityScore
    ),
    0,
    100
  )
}

const computeInterviewRubric = (
  text = '',
  question = '',
  resumeText = ''
) => {
  const source =
    normalizeText(`${question} ${resumeText} ${text}`)

  if (!source) return 0

  const starSignals = [
    'situation',
    'task',
    'action',
    'result',
    'example',
    'experience',
    'i led',
    'i improved',
    'i built',
    'i handled',
  ]

  const starScore =
    Math.min(
      25,
      countMatches(source.toLowerCase(), starSignals) * 4
    )

  const keywordTerms = [
    'customer',
    'team',
    'project',
    'problem',
    'solution',
    'impact',
    'metric',
    'improved',
    'reduced',
    'increased',
    'delivered',
  ]

  const relevanceScore =
    Math.min(
      20,
      countMatches(source.toLowerCase(), keywordTerms) * 3
    )

  const answerLength =
    source.split(' ').length

  const lengthScore =
    answerLength >= 60 && answerLength <= 220
      ? 20
      : answerLength > 220
        ? 16
        : 12

  const clarityWords = [
    'because',
    'therefore',
    'so',
    'which',
    'when',
    'while',
    'after',
    'before',
  ]

  const clarityScore =
    Math.min(
      15,
      countMatches(source.toLowerCase(), clarityWords) * 2
    )

  const confidenceScore =
    text.toLowerCase().includes('i') ? 10 : 6

  const resultScore =
    source.toLowerCase().includes('result') ||
    source.toLowerCase().includes('impact')
      ? 10
      : 6

  return clamp(
    Math.round(
      starScore +
      relevanceScore +
      lengthScore +
      clarityScore +
      confidenceScore +
      resultScore
    ),
    0,
    100
  )
}

const buildRubricFeedback = (
  type,
  text,
  resumeText,
  question = ''
) => {
  const fallback = {
    resume: {
      mistakes: [
        'Add measurable outcomes and impact numbers.',
        'Use stronger action verbs and ATS keywords.',
        'Improve section clarity for skills and experience.',
      ],
      improvements: [
        'Add numbers like % improvement or time saved.',
        'Align keywords to the target role.',
        'Highlight top achievements first.',
      ],
      keywords: [
        'leadership',
        'product',
        'teamwork',
        'analytics',
        'communication',
        'problem solving',
      ],
    },

    intro: {
      feedback: [
        'Open with a confident summary of who you are and your current focus.',
        'Keep the introduction structured: background, strengths, and role fit.',
        'Use more concise and energetic phrasing.',
      ],
      generatedAnswer:
        'Hi, I am a driven candidate with experience in ...',
    },

    interview: {
      feedback: [
        'Use the STAR format to structure answers.',
        'Add metrics and business impact to your examples.',
        'Keep your answers specific and role-related.',
      ],
      betterAnswerTip:
        'Frame your example around the problem, action, and measurable result.',
    },
  }

  if (type === 'resume') {
    const normalized =
      normalizeText(`${resumeText} ${text}`)

    const keywords = [
      'leadership',
      'teamwork',
      'communication',
      'problem solving',
      'analytics',
      'product',
      'design',
      'strategy',
      'engineering',
      'execution',
    ]

    const matched =
      keywords.filter((keyword) =>
        normalized.toLowerCase().includes(keyword)
      )

    return {
      mistakes:
        normalized.length < 300
          ? [
              'Resume is too short for a strong professional summary.',
              'Add quantifiable achievements and stronger role alignment.',
            ]
          : fallback.resume.mistakes,

      improvements:
        normalized.includes('%')
          ? fallback.resume.improvements
          : [
              'Add measurable metrics and business impact.',
              'Include more target-role keywords.',
              'Strengthen the summary section.',
            ],

      keywords:
        matched.length
          ? matched
          : fallback.resume.keywords,
    }
  }

  if (type === 'intro') {
    return {
      feedback:
        fallback.intro.feedback,

      generatedAnswer:
        `Hi, I am a candidate with experience in ${
          resumeText
            ? 'relevant work and strong communication skills.'
            : 'my field, and I am excited to share how I add value.'
        }`,
    }
  }

  return {
    feedback:
      fallback.interview.feedback,

    betterAnswerTip:
      question
        ? `Use the question to anchor your answer: explain the challenge, the action you took, and the measurable outcome.${question}`
        : fallback.interview.betterAnswerTip,
  }
}

// Health check
app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    geminiConfigured: Boolean(ai),
  })
})

// AI analysis API
app.post('/api/analyze', async (request, response) => {
  if (!ai) {
    return response.status(500).json({
      error:
        'GEMINI_API_KEY is missing in environment variables',
    })
  }

  const {
    type = 'resume',
    text = '',
    resumeText = '',
    question = '',
    video,
    file,
  } = request.body

  if (!text && !file?.data) {
    return response.status(400).json({
      error: 'text or file is required',
    })
  }

  const context = `Candidate resume:
${resumeText || 'Not provided'}

Current question:
${question || 'Not provided'}

Spoken transcript:
${text}`

  const prompts = {
    resume: `Analyze the attached resume file for ATS compatibility.
Do not reuse a previous score.
Calculate a fresh score from this exact file.
Return valid JSON only with this shape:
{"score": number, "mistakes": string[], "improvements": string[], "keywords": string[]}.
If text is available, use it too:
${text}`,

    intro: `Analyze the candidate's self introduction using the transcript, resume, and attached video when available.
Return valid JSON only with this shape:
{"score": number, "eyeContact": number, "pronunciation": number, "confidence": number, "wording": number, "feedback": string[], "generatedAnswer": string}.
${context}`,

    interview: `Evaluate the candidate's interview answer using every provided input: transcript, resume, current question, and attached video when available.
Generate a concise, specific model answer grounded in the candidate's real experience.
Return valid JSON only with this shape:
{"score": number, "relevant": boolean, "feedback": string[], "betterAnswerTip": string, "generatedAnswer": string}.
${context}`,
  }

  try {
    const contentParts = [
      {
        text:
          prompts[type] ??
          prompts.resume,
      },
    ]

    if (file?.data && file?.mimeType) {
      contentParts.push({
        inlineData: {
          mimeType:
            file.mimeType,
          data:
            file.data,
        },
      })
    }

    if (video?.data && video?.mimeType) {
      contentParts.push({
        inlineData: {
          mimeType:
            video.mimeType,
          data:
            video.data,
        },
      })
    }

    let result
    let lastError

    for (
      let attempt = 0;
      attempt < 3;
      attempt += 1
    ) {
      try {
        result =
          await ai.models.generateContent({
            model:
              geminiModel,

            contents: [
              {
                role:
                  'user',

                parts:
                  contentParts,
              },
            ],

            config: {
              responseMimeType:
                'application/json',
            },
          })

        break
      } catch (error) {
        lastError =
          error

        const status =
          error?.status

        if (
          status !== 503 &&
          status !== 429 &&
          error?.code !==
            'UND_ERR_CONNECT_TIMEOUT'
        ) {
          throw error
        }

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              1000 *
                (attempt + 1)
            )
        )
      }
    }

    if (!result) {
      throw lastError
    }

    const aiResult =
      JSON.parse(
        result.text ??
          '{}'
      )

    const rubricType =
      type === 'intro'
        ? 'intro'
        : type === 'interview'
          ? 'interview'
          : 'resume'

    const rubricScore =
      rubricType === 'resume'
        ? computeResumeRubric(
            text,
            resumeText
          )
        : rubricType === 'intro'
          ? computeIntroRubric(
              text,
              resumeText
            )
          : computeInterviewRubric(
              text,
              question,
              resumeText
            )

    const baseScore =
      Number(
        aiResult.score ??
          0
      )

    const blendedScore =
      clamp(
        Math.round(
          baseScore *
            0.65 +
            rubricScore *
              0.35
        ),
        0,
        100
      )

    const finalResult = {
      ...aiResult,
      score:
        blendedScore,
    }

    if (
      rubricType ===
      'resume'
    ) {
      const rubricData =
        buildRubricFeedback(
          'resume',
          text,
          resumeText,
          question
        )

      finalResult.mistakes =
        aiResult.mistakes?.length
          ? aiResult.mistakes
          : rubricData.mistakes

      finalResult.improvements =
        aiResult.improvements?.length
          ? aiResult.improvements
          : rubricData.improvements

      finalResult.keywords =
        aiResult.keywords?.length
          ? aiResult.keywords
          : rubricData.keywords
    }

    if (
      rubricType ===
      'intro'
    ) {
      const rubricData =
        buildRubricFeedback(
          'intro',
          text,
          resumeText,
          question
        )

      finalResult.feedback =
        aiResult.feedback?.length
          ? aiResult.feedback
          : rubricData.feedback

      finalResult.generatedAnswer =
        aiResult.generatedAnswer ||
        rubricData.generatedAnswer
    }

    if (
      rubricType ===
      'interview'
    ) {
      const rubricData =
        buildRubricFeedback(
          'interview',
          text,
          resumeText,
          question
        )

      finalResult.feedback =
        aiResult.feedback?.length
          ? aiResult.feedback
          : rubricData.feedback

      finalResult.betterAnswerTip =
        aiResult.betterAnswerTip ||
        rubricData.betterAnswerTip

      finalResult.generatedAnswer =
        aiResult.generatedAnswer ||
        `Here is a stronger answer: ${
          question ||
          'Explain your experience and impact with clear examples.'
        }`
    }

    return response.json(
      finalResult
    )
  } catch (error) {
    console.error(
      'Gemini analysis error:',
      error
    )

    const status =
      error?.status === 503 ||
      error?.status === 429
        ? 503
        : 502

    const message =
      status === 503
        ? 'Gemini is temporarily busy. Please try again in a few seconds.'
        : 'Gemini analysis failed. Check the backend logs and try again.'

    return response
      .status(status)
      .json({
        error:
          message,
      })
  }
})

// Serve React frontend
app.use(
  express.static(
    distPath
  )
)

// React frontend fallback
app.get(
  '/{*path}',
  (_request, response) => {
    response.sendFile(
      path.join(
        distPath,
        'index.html'
      )
    )
  }
)

// Start server
app.listen(
  port,
  '0.0.0.0',
  () => {
    console.log(
      `Gemini API server running on port ${port}`
    )

    console.log(
      `Frontend build directory: ${distPath}`
    )
  }
)
