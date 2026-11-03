export type AnalysisResult = {
  score: number
  mistakes?: string[]
  improvements?: string[]
  keywords?: string[]
  eyeContact?: number
  pronunciation?: number
  confidence?: number
  grammar?: number
  wording?: number
  relevant?: boolean
  feedback?: string[]
  betterAnswerTip?: string
  generatedAnswer?: string
}

type InterviewAnswer = { question: string; answer: string }

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))
const countMatches = (text: string, keywords: string[]) =>
  keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length

export async function extractResumeText(file: File) {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.pdf') || file.type.includes('pdf')) {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) })
    try {
      return normalizeText((await parser.getText()).text)
    } finally {
      await parser.destroy()
    }
  }

  if (fileName.endsWith('.docx') || file.type.includes('word')) {
    const { default: mammoth } = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return normalizeText(result.value)
  }

  return normalizeText(await file.text())
}

export function analyzeResume(text: string): AnalysisResult {
  const source = normalizeText(text).toLowerCase()
  if (!source) throw new Error('The selected file does not contain readable text.')

  const sections = ['experience', 'skills', 'education', 'summary', 'projects']
  const sectionScore = sections.filter((section) => source.includes(section)).length * 6
  const metrics = /(\d+%|\d+\+|\d+ years|\d+ months|\$\d+|\b\d+\b)/i.test(source) ? 15 : 0
  const actionWords = ['led', 'built', 'improved', 'managed', 'delivered', 'developed', 'designed', 'optimized', 'launched']
  const actionScore = Math.min(15, countMatches(source, actionWords) * 3)
  const keywordTerms = ['react', 'javascript', 'typescript', 'python', 'sql', 'node', 'aws', 'design', 'research', 'project', 'team', 'communication', 'problem', 'product']
  const keywordScore = Math.min(20, countMatches(source, keywordTerms) * 2)
  const readability = source.length > 200 ? 15 : 8
  const bulletScore = /[-•*]/.test(source) ? 15 : 8
  const hasMetrics = /\d+%|\$\d+|\b\d+\b/.test(source)
  const wordCount = source.split(' ').length
  const scoreCeiling = wordCount < 40 ? 40 : wordCount < 100 ? 60 : wordCount < 200 ? 80 : 100

  return {
    score: clamp(Math.min(scoreCeiling, Math.round(sectionScore + metrics + actionScore + keywordScore + readability + bulletScore))),
    mistakes: hasMetrics
      ? ['Use strong action verbs consistently.', 'Align keywords to the target role.', 'Highlight the most relevant achievements first.']
      : ['Add measurable outcomes and impact numbers.', 'Use stronger action verbs and ATS keywords.', 'Clarify the skills and experience sections.'],
    improvements: hasMetrics
      ? ['Align keywords to the target role.', 'Highlight your strongest achievements first.', 'Keep formatting consistent and easy to scan.']
      : ['Add numbers such as percentage improvement or time saved.', 'Align keywords to the target role.', 'Highlight the strongest achievements first.'],
    keywords: keywordTerms.filter((keyword) => source.includes(keyword)).slice(0, 6),
  }
}

export function analyzeIntroduction(text: string, language = 'en-IN'): AnalysisResult {
  const source = normalizeText(text).toLowerCase()
  if (!source) throw new Error('Add or dictate your introduction before requesting a score.')

  const wordCount = source.split(' ').length
  const lengthScore = wordCount >= 60 && wordCount <= 180 ? 20 : wordCount > 180 ? 16 : 10
  const structureWords = ['hello', 'my name', 'i am', 'currently', 'experience', 'skills', 'strengths', 'thank', 'excited', 'interested']
  const structureScore = Math.min(20, countMatches(source, structureWords) * 3)
  const confidenceWords = ['confident', 'passionate', 'excited', 'strong', 'focused', 'motivated', 'comfortable', 'able', 'experience']
  const confidenceScore = Math.min(20, countMatches(source, confidenceWords) * 2)
  const clarityScore = source.length > 180 ? 20 : 14
  const fillerCount = (source.match(/\b(um|uh|like|actually|basically)\b/g) || []).length
  const fillerPenalty = Math.min(25, fillerCount * 5)
  const grammarFlags = [
    /\bi am agree\b/,
    /\bshe don't\b|\bhe don't\b/,
    /\btheir is\b|\bthere are a\b/,
    /\bi has\b|\bwe was\b/,
  ].filter((pattern) => pattern.test(source)).length
  const grammar = language.startsWith('ta') ? undefined : clamp(92 - grammarFlags * 15 - (/[.!?]$/.test(text.trim()) ? 0 : 4))

  return {
    score: clamp(Math.round(lengthScore + structureScore + confidenceScore + 10 + clarityScore - fillerPenalty)),
    pronunciation: undefined,
    confidence: clamp((wordCount >= 50 ? 78 : 60) - fillerPenalty, 40, 92),
    grammar,
    wording: clamp((wordCount >= 60 && wordCount <= 180 ? 86 : 68) - fillerPenalty, 40, 95),
    feedback: [
      'Eye contact is estimated from webcam face and gaze landmarks; it is not a precise measurement.',
      fillerCount ? `Reduce filler words; ${fillerCount} were detected.` : 'No common filler words were detected.',
      language.startsWith('ta')
        ? 'Tamil grammar checking is not available in the offline checker.'
        : grammarFlags ? 'Review the grammar patterns highlighted by the local checker.' : 'No common grammar patterns were flagged; review the transcript before relying on it.',
    ],
    generatedAnswer: 'Introduce your background, highlight one or two relevant strengths, and close with why this role interests you.',
  }
}

function scoreAnswer({ question, answer }: InterviewAnswer) {
  const text = normalizeText(answer).toLowerCase()
  const words = text.split(' ').filter(Boolean)
  const wordCount = words.length
  const lengthScore = wordCount >= 40 && wordCount <= 180 ? 20 : wordCount >= 20 ? 14 : wordCount > 180 ? 16 : 6
  const starSignals = ['situation', 'task', 'action', 'result', 'example', 'i led', 'i improved', 'i built', 'i handled']
  const structureScore = Math.min(25, countMatches(text, starSignals) * 5)
  const hasEvidence = /\d+%|\$\d+|\b\d+\b/.test(text)
  const evidenceScore = hasEvidence ? 20 : 6
  const clarityWords = ['because', 'therefore', 'which', 'when', 'while', 'after', 'before']
  const clarityScore = Math.min(15, countMatches(text, clarityWords) * 3)
  const ownershipScore = /\b(i|my|we|our)\b/.test(text) ? 10 : 4
  const questionTerms = normalizeText(question).toLowerCase().split(' ').filter((word) => word.length > 4)
  const overlapCount = questionTerms.filter((word) => text.includes(word)).length
  const relevanceScore = questionTerms.length ? Math.min(10, Math.round((overlapCount / questionTerms.length) * 20)) : 5

  return clamp(Math.round(lengthScore + structureScore + evidenceScore + clarityScore + ownershipScore + relevanceScore))
}

export function analyzeInterview(answers: InterviewAnswer[], language = 'en-IN'): AnalysisResult {
  const answered = answers.filter(({ answer }) => normalizeText(answer).length > 0)
  if (!answered.length) throw new Error('Answer at least one question before requesting a score.')

  const score = Math.round(answered.reduce((total, answer) => total + scoreAnswer(answer), 0) / answered.length)
  const transcript = answered.map(({ answer }) => answer).join(' ').toLowerCase()
  const grammarFlags = [
    /\bi am agree\b/,
    /\bshe don't\b|\bhe don't\b/,
    /\btheir is\b|\bthere are a\b/,
    /\bi has\b|\bwe was\b/,
  ].filter((pattern) => pattern.test(transcript)).length
  return {
    score,
    grammar: language.startsWith('ta') ? undefined : clamp(92 - grammarFlags * 15),
    relevant: score >= 50,
    feedback: [
      language.startsWith('ta')
        ? 'Tamil grammar checking is not available in the offline checker.'
        : grammarFlags ? 'Review common English grammar patterns flagged in the transcript.' : 'No common English grammar patterns were flagged; read the transcript for accuracy.',
      'Include specific outcomes or numbers where you can.',
      'Keep each answer focused on what you personally did.',
    ],
    betterAnswerTip: 'Connect the challenge to your specific action, then explain the measurable result.',
    generatedAnswer: 'Structure each response around the situation, your responsibility, the action you took, and the result. Use only details from your real experience.',
  }
}

const skillTerms = [
  'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL', 'AWS', 'Azure',
  'Figma', 'research', 'design system', 'accessibility', 'analytics', 'leadership', 'testing',
  'communication', 'project management', 'customer support', 'sales', 'Excel',
]

export function createInterviewQuestions(resume: string, introduction: string, stress = false) {
  const combined = `${resume} ${introduction}`.toLowerCase()
  const skills = skillTerms.filter((skill) => combined.includes(skill.toLowerCase())).slice(0, 4)
  const focus = skills[0] || 'your experience'
  const secondFocus = skills[1] || 'your recent project'
  const project = resume
    .split(/[\n.!?]+/)
    .map((part) => part.trim())
    .find((part) => part.length > 35 && /\b(led|built|created|improved|managed|delivered|designed|developed|launched)\b/i.test(part))
  const introTopic = introduction.trim().split(/\s+/).slice(0, 8).join(' ')

  if (stress) {
    return [
      `Your resume highlights ${focus}. What evidence proves you are genuinely strong at it?`,
      'Your answer sounds rehearsed. Can you give a specific example right now?',
      `Why should we hire you instead of another candidate with ${focus} experience?`,
      'Tell me about a failure you caused. What was your responsibility?',
      'Your results seem modest. Why should we consider them significant?',
      'What would your last manager say is your biggest weakness?',
      `You mentioned ${secondFocus}. What would you do if your approach failed under pressure?`,
      'Why did you leave, or why are you considering leaving, your last role?',
      'If we reject your proposal in this interview, how would you respond?',
      'What is the strongest reason not to hire you?',
    ]
  }

  return [
    `Walk me through your experience and the decisions behind ${project ? 'this achievement: ' + project.slice(0, 95) : 'your most recent project'}.`,
    `How have you used ${focus} to solve a difficult problem?`,
    `What did you learn while working with ${secondFocus}, and what would you improve?`,
    'Tell me about a measurable result you delivered and how you contributed to it.',
    `Your introduction mentions "${introTopic || 'your experience'}". Which experience best supports that statement?`,
    'Describe a time you received difficult feedback and what changed afterward.',
    'How do you prioritize when multiple deadlines compete?',
    'Tell me about a disagreement with a teammate and how you resolved it.',
    'How do you make sure your work is reliable before sharing or shipping it?',
    'Describe a time you had to learn an unfamiliar tool or codebase quickly.',
    'What is a project setback you faced, and how did you recover?',
    'How do you explain a complex decision to a non-technical stakeholder?',
    'Which accomplishment on your resume are you most proud of, and why?',
    'What skill are you currently developing for your next role?',
    'Why is this role the right next step for you?',
  ]
}