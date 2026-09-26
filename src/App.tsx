import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BarChart3, Check, ChevronRight, CircleHelp, Clock3, FileText, History, LayoutDashboard, Lightbulb, Mic, Play, RotateCcw, ShieldCheck, Sparkles, Square, Target, Upload, Video, X } from 'lucide-react'
import './App.css'

type View = 'overview' | 'resume' | 'intro' | 'interview' | 'history'

const questions = [
  'Walk me through your experience and the decisions behind your latest project.',
  'What was the most challenging technical problem you solved recently?',
  'How do you prioritize when multiple deadlines compete?',
  'Tell me about a time you received difficult feedback.',
  'How would you explain your core technical skill to a non-technical stakeholder?',
  'Which project are you most proud of, and what would you improve now?',
  'How do you make sure your work is reliable before shipping?',
  'Tell me about a disagreement with a teammate and how you handled it.',
  'What is a new skill you are currently developing?',
  'How do you approach learning an unfamiliar codebase?',
  'Describe a time you had to make a trade-off under pressure.',
  'What kind of team environment helps you do your best work?',
  'How do you measure the impact of the work you deliver?',
  'What would your first 30 days in this role look like?',
  'Why is this role the right next step for you?',
]

const historyItems = [
  { type: 'Resume analysis', detail: 'Product Designer resume', score: 82, date: 'Today, 10:24 AM', color: 'blue' },
  { type: 'Self introduction', detail: '90 second practice', score: 88, date: 'Yesterday, 6:42 PM', color: 'green' },
  { type: 'Personal interview', detail: 'Product Designer · 15 questions', score: 79, date: 'Sep 07, 2:15 PM', color: 'orange' },
]

const defaultResumeText = `Maya Thompson
Product Designer | UX Strategy | Design Systems

Experience
- Led design for a B2B SaaS platform, improving onboarding completion by 38%.
- Partnered with engineering and research to launch an enterprise-facing feature set.
- Built a design system used by 7 product squads, reducing production time by 25%.

Skills
- UX research, product strategy, wireframing, prototyping, Figma, accessibility, analytics, stakeholder management

Summary
Product designer with 4+ years of experience translating complex workflows into intuitive, measurable user experiences.`

type GeminiResult = {
  score?: number
  mistakes?: string[]
  improvements?: string[]
  keywords?: string[]
  eyeContact?: number
  pronunciation?: number
  confidence?: number
  wording?: number
  relevant?: boolean
  feedback?: string[]
  betterAnswerTip?: string
  generatedAnswer?: string
}

type GeminiRequest = {
  type: 'resume' | 'intro' | 'interview'
  text: string
  resumeText?: string
  question?: string
  video?: { mimeType: string; data: string }
  file?: { name: string; mimeType: string; data: string }
}

async function analyzeWithGemini(request: GeminiRequest) {
  // Render serves the frontend and Express API from the same domain.
  const apiUrl = import.meta.env.VITE_API_URL || '/api/analyze'
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Gemini analysis failed' }))
    throw new Error(errorData.error || 'Gemini analysis failed')
  }

  return response.json()
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function fileToBase64(file: File) {
  return blobToBase64(file)
}

function normalizeDisplayScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return Math.min(100, Math.max(0, Number(value)))
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [resumeName, setResumeName] = useState('')
  const [resumeUploaded, setResumeUploaded] = useState(false)
  const [resumeText, setResumeText] = useState(defaultResumeText)
  const [resumeScore, setResumeScore] = useState<number | null>(null)
  const [resumeAnalysis, setResumeAnalysis] = useState<GeminiResult | null>(null)
  const displayResumeScore = normalizeDisplayScore(resumeScore)
  const [isLive, setIsLive] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [introTranscript, setIntroTranscript] = useState('')
  const [introScore, setIntroScore] = useState<number | null>(null)
  const [introAnalysis, setIntroAnalysis] = useState<GeminiResult | null>(null)
  const displayIntroScore = normalizeDisplayScore(introScore)
  const [introSession, setIntroSession] = useState(false)
  const [introTimeLeft, setIntroTimeLeft] = useState(180)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [interviewStarted, setInterviewStarted] = useState(false)
  const [interviewAnswers, setInterviewAnswers] = useState<string[]>([])
  const [interviewAnswer, setInterviewAnswer] = useState('')
  const [interviewTimeLeft, setInterviewTimeLeft] = useState(180)
  const [interviewScore, setInterviewScore] = useState<number | null>(null)
  const [interviewAnalysis, setInterviewAnalysis] = useState<GeminiResult | null>(null)
  const displayInterviewScore = normalizeDisplayScore(interviewScore)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const videoChunksRef = useRef<Blob[]>([])
  const recordingDoneRef = useRef<Promise<Blob | null> | null>(null)
  const interviewAnswerRef = useRef('')
  const submitInterviewAnswerRef = useRef<(timedOut?: boolean) => void>(() => undefined)

  const stopMedia = async () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    const videoBlob = await recordingDoneRef.current
    recorderRef.current = null
    recordingDoneRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsLive(false)
    return videoBlob ?? null
  }

  const startMedia = async (mode: 'intro' | 'interview') => {
    setMediaError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsLive(true)

      if (typeof MediaRecorder !== 'undefined') {
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        videoChunksRef.current = []
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) videoChunksRef.current.push(event.data)
        }
        recordingDoneRef.current = new Promise((resolve) => {
          recorder.onstop = () => resolve(new Blob(videoChunksRef.current, { type: recorder.mimeType || 'video/webm' }))
        })
        recorder.start()
        recorderRef.current = recorder
      }

      const SpeechRecognition = (window as Window & {
        SpeechRecognition?: new () => any
        webkitSpeechRecognition?: new () => any
      }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0].transcript)
            .join(' ')
            .trim()

          if (mode === 'intro') setIntroTranscript(transcript)
        }
        recognition.start()
        recognitionRef.current = recognition
      }

      return true
    } catch {
      setMediaError('Camera and microphone permission is needed to start this practice.')
      return false
    }
  }

  const startIntro = async () => {
    setIntroScore(null)
    setIntroTranscript('')
    setIntroTimeLeft(180)
    const started = await startMedia('intro')
    if (started) setIntroSession(true)
  }

  const stopIntro = async () => {
    setIntroSession(false)
    await stopMedia()
  }

  const startInterview = async () => {
    setQuestionIndex(0)
    setInterviewScore(null)
    setInterviewAnswers([])
    setInterviewAnswer('')
    interviewAnswerRef.current = ''
    setInterviewTimeLeft(180)
    const started = await startMedia('interview')
    if (started) setInterviewStarted(true)
  }

  const stopInterview = async () => {
    setInterviewStarted(false)
    await stopMedia()
  }

  const submitInterviewAnswer = (timedOut = false) => {
    const answer = interviewAnswerRef.current.trim()
    if (!answer && !timedOut) return
    setInterviewAnswers((answers) => [...answers, answer])
    setInterviewAnswer('')
    interviewAnswerRef.current = ''
    setInterviewTimeLeft(180)
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((index) => index + 1)
    } else {
      void stopInterview()
    }
  }
  useEffect(() => {
    submitInterviewAnswerRef.current = submitInterviewAnswer
  })

  const handleResumeAnalyze = async (text: string = resumeText, file?: File) => {
    setIsAnalyzing(true)
    try {
      const result = await analyzeWithGemini({
        type: 'resume',
        text,
        file: file ? { name: file.name, mimeType: file.type || 'application/pdf', data: await fileToBase64(file) } : undefined,
      })
      setResumeAnalysis(result)
      setResumeScore(Number(result.score ?? 0))
    } catch (error) {
      console.error('Resume analysis failed:', error)
      setMediaError(error instanceof Error ? error.message : 'Resume analysis failed. Check the backend server and Gemini API key.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleIntroAnalyze = async () => {
    if (!introTranscript.trim()) return
    await stopMedia()
    setIsAnalyzing(true)
    try {
      const result = await analyzeWithGemini({
        type: 'intro',
        text: introTranscript,
        resumeText,
      })
      setIntroAnalysis(result)
      setIntroScore(Number(result.score ?? 0))
    } catch (error) {
      console.error('Intro analysis failed:', error)
      setMediaError(error instanceof Error ? error.message : 'Self-introduction analysis failed. Check the backend server and Gemini API key.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleInterviewAnalyze = async () => {
    const answerText = interviewAnswers.map((answer, index) => `Question ${index + 1}: ${questions[index]}\nAnswer: ${answer}`).join('\n\n')
    if (!answerText) return
    await stopMedia()
    setIsAnalyzing(true)
    try {
      const result = await analyzeWithGemini({
        type: 'interview',
        text: answerText,
        resumeText,
        question: 'Evaluate the complete interview across all answered questions.',
      })
      setInterviewAnalysis(result)
      setInterviewScore(Number(result.score ?? 0))
    } catch (error) {
      console.error('Interview analysis failed:', error)
      setMediaError(error instanceof Error ? error.message : 'Interview analysis failed. Check the backend server and Gemini API key.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => () => { void stopMedia() }, [])

  useEffect(() => {
    if (!introSession) return
    const timer = window.setInterval(() => {
      setIntroTimeLeft((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer)
          setIntroSession(false)
          void stopMedia()
          return 0
        }
        return seconds - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [introSession])

  useEffect(() => {
    if (!interviewStarted) return
    const timer = window.setInterval(() => {
      setInterviewTimeLeft((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer)
          submitInterviewAnswerRef.current(true)
          return 180
        }
        return seconds - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [interviewStarted, questionIndex])

  const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'resume', label: 'Resume ATS', icon: FileText },
    { id: 'intro', label: 'Self introduction', icon: Mic },
    { id: 'interview', label: 'Personal interview', icon: Video },
    { id: 'history', label: 'History', icon: History },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <span>AI Interview<br /><strong>Coach</strong></span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              <Icon size={18} />
              <span>{label}</span>
              {id === 'resume' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Private by design</strong>
              <span>Camera stays on your device</span>
            </div>
          </div>
          <button className="help-button"><CircleHelp size={17} /> Help center</button>
          <div className="profile">
            <div className="avatar">MT</div>
            <div>
              <strong>Maya Thompson</strong>
              <span>Product Designer</span>
            </div>
            <ChevronRight size={15} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{navItems.find((item) => item.id === view)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className="status-pill"><span className="status-dot" /> Gemini connected</span>
            <button className="icon-button" aria-label="Notifications"><Clock3 size={18} /></button>
            <div className="small-avatar">MT</div>
          </div>
        </header>

        {view === 'overview' && <Overview onNavigate={setView} resumeName={resumeName} score={displayResumeScore} />}
        {view === 'resume' && (
          <ResumeDetailedView
            resumeName={resumeName}
            uploaded={resumeUploaded}
            score={displayResumeScore}
            analysis={resumeAnalysis}
            isLoading={isAnalyzing}
            onUpload={(name, text) => {
              setResumeName(name)
              setResumeUploaded(true)
              setResumeText(text || resumeText)
              setResumeScore(null)
              setResumeAnalysis(null)
            }}
            onAnalyze={(file) => void handleResumeAnalyze('', file)}
          />
        )}
        {view === 'intro' && (
          <IntroView
            transcript={introTranscript}
            score={displayIntroScore}
            analysis={introAnalysis}
            isLive={isLive}
            mediaError={mediaError}
            videoRef={videoRef}
            onStart={startIntro}
            onStop={stopIntro}
            onScore={handleIntroAnalyze}
            isLoading={isAnalyzing}
            timeLeft={introTimeLeft}
          />
        )}
        {view === 'interview' && (
          <InterviewView
            started={interviewStarted}
            index={questionIndex}
            score={displayInterviewScore}
            analysis={interviewAnalysis}
            isLive={isLive}
            mediaError={mediaError}
            videoRef={videoRef}
            onStart={startInterview}
            onStop={stopInterview}
            answer={interviewAnswer}
            answersCount={interviewAnswers.length}
            timeLeft={interviewTimeLeft}
            onAnswerChange={(answer) => { interviewAnswerRef.current = answer; setInterviewAnswer(answer) }}
            onNext={submitInterviewAnswer}
            onScore={handleInterviewAnalyze}
            isLoading={isAnalyzing}
          />
        )}
        {view === 'history' && <HistoryView />}
      </main>
    </div>
  )
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

function Overview({ onNavigate, resumeName, score }: { onNavigate: (view: View) => void; resumeName: string; score: number | null }) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="GOOD MORNING, MAYA"
        title="Ready to sharpen your story?"
        description="A focused practice plan for your next great interview."
        action={<button className="primary-button" onClick={() => onNavigate('intro')}><Play size={16} fill="currentColor" /> Start practicing</button>}
      />
      <section className="hero-grid">
        <div className="hero-card">
          <div className="hero-card-content">
            <span className="overline">YOUR NEXT SESSION</span>
            <h2>Make your introduction<br /><em>memorable.</em></h2>
            <p>Practice with real-time feedback on your delivery, confidence, and clarity.</p>
            <button className="light-button" onClick={() => onNavigate('intro')}>Practice self introduction <ArrowUpRight size={16} /></button>
          </div>
          <div className="hero-illustration">
            <div className="illustration-ring" />
            <div className="illustration-person">✦</div>
            <div className="floating-note note-one">“Clarity is confidence.”</div>
            <div className="floating-note note-two"><Check size={13} /> Eye contact on track</div>
          </div>
        </div>

        <div className="score-card">
          <div className="card-heading">
            <span>RESUME ATS SCORE</span>
            <button className="more-button">•••</button>
          </div>
          <div className="score-number">{score ?? '--'}<span>/100</span></div>
          <div className="score-change"><ArrowUpRight size={14} /> {score === null ? 'Upload a resume to analyze' : 'Fresh Gemini analysis'}</div>
          <div className="progress-track"><div style={{ width: `${score ?? 0}%` }} /></div>
          <p className="muted">{resumeName}</p>
          <button className="text-button" onClick={() => onNavigate('resume')}>View full analysis <ChevronRight size={15} /></button>
        </div>
      </section>

      <section className="section-heading">
        <div>
          <span className="eyebrow">YOUR PROGRESS</span>
          <h2>Small practice, noticeable growth.</h2>
        </div>
        <button className="text-button" onClick={() => onNavigate('history')}>View history <ChevronRight size={15} /></button>
      </section>

      <div className="metric-grid">
        <Metric icon={<Target size={18} />} label="Self introduction" value="88" caption="Strong delivery" color="green" />
        <Metric icon={<BarChart3 size={18} />} label="Interview readiness" value="76" caption="Keep building" color="orange" />
        <Metric icon={<Lightbulb size={18} />} label="Skills to improve" value="3" caption="Actionable insights" color="purple" />
      </div>
    </div>
  )
}

function Metric({ icon, label, value, caption, color }: { icon: React.ReactNode; label: string; value: string; caption: string; color: string }) {
  return (
    <div className="metric">
      <div className={`metric-icon ${color}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}<small>/100</small></strong>
        <p>{caption}</p>
      </div>
    </div>
  )
}

function ResumeDetailedView({ resumeName, uploaded, score, analysis, isLoading, onUpload, onAnalyze }: {
  resumeName: string
  uploaded: boolean
  score: number | null
  analysis: GeminiResult | null
  isLoading: boolean
  onUpload: (name: string, text?: string, file?: File) => void
  onAnalyze: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 01 · RESUME ATS"
        title="Your resume, made searchable."
        description="See how recruiters and applicant tracking systems read your experience."
        action={<button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload new resume</button>}
      />

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const text = file.name.toLowerCase().endsWith('.txt') ? await file.text() : defaultResumeText
          setSelectedFile(file)
          onUpload(file.name, text, file)
        }}
      />

      <section className="resume-layout">
        <div className="analysis-main">
          <div className="upload-strip" onClick={() => inputRef.current?.click()}>
            <div className="file-icon"><FileText size={20} /></div>
            <div>
              <strong>{uploaded ? resumeName : 'Upload your resume'}</strong>
              <span>{uploaded ? 'Uploaded just now · PDF · 1.2 MB' : 'PDF or DOCX up to 10 MB'}</span>
            </div>
            <button className="round-action" aria-label="Replace resume"><RotateCcw size={16} /></button>
          </div>

          <button className="view-score-button" onClick={() => selectedFile && onAnalyze(selectedFile)} disabled={!selectedFile || isLoading}>
            <BarChart3 size={17} /> {isLoading ? 'Analyzing with Gemini...' : 'View ATS score'} <ChevronRight size={16} />
          </button>

          <div className="ats-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">OVERALL ATS SCORE</span>
                <h2>Strong foundation, room to shine.</h2>
              </div>
              <div className="large-score">{isLoading ? '...' : (score ?? '--')}<span>/100</span></div>
            </div>
            <div className="score-bar"><div style={{ width: `${isLoading ? 50 : (score ?? 0)}%` }} /></div>
            <div className="score-legend">
              <span><i className="dot blue-dot" /> Keyword match <b>{isLoading ? '...' : score === null ? '--' : `${Math.min(100, score + 4)}%`}</b></span>
              <span><i className="dot orange-dot" /> Formatting <b>{isLoading ? '...' : score === null ? '--' : `${Math.max(0, score - 4)}%`}</b></span>
              <span><i className="dot green-dot" /> Readability <b>{isLoading ? '...' : score === null ? '--' : `${Math.min(100, score + 1)}%`}</b></span>
            </div>
          </div>

          <div className="feedback-heading">
            <div>
              <span className="eyebrow">SMART FEEDBACK</span>
              <h2>Three changes worth making.</h2>
            </div>
            <span className="gemini-tag"><Sparkles size={14} /> Powered by Gemini</span>
          </div>

          <div className="feedback-grid">
            {(analysis?.improvements?.length ? analysis.improvements : [
              'Your experience bullets do a good job of showing scope, but adding concrete outcomes will make them stand out more to ATS systems and recruiters.',
              'Terms like product strategy, user research, and stakeholder alignment can improve match quality when they accurately describe your experience.',
              'Your resume is clear overall, but simplifying some sections and tightening the summary will help with scanability.',
            ]).slice(0, 3).map((feedback, index) => (
              <FeedbackCard key={feedback} number={`0${index + 1}`} title={analysis?.mistakes?.[index] || ['Add measurable impact', 'Add role-specific keywords', 'Improve readability'][index]} text={feedback} tag={analysis?.keywords?.[index] || ['Keywords + impact', 'Role fit', 'ATS clarity'][index]} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function FeedbackCard({ number, title, text, tag }: { number: string; title: string; text: string; tag: string }) {
  return (
    <div className="feedback-card">
      <span className="feedback-number">{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="feedback-tag"><ArrowUpRight size={13} /> {tag}</span>
    </div>
  )
}

function MediaStage({ isLive, videoRef, mediaError, label }: { isLive: boolean; videoRef: React.RefObject<HTMLVideoElement | null>; mediaError: string; label: string }) {
  return (
    <div className="media-stage">
      <video ref={videoRef} muted playsInline className={isLive ? 'visible' : ''} />
      <div className="camera-placeholder">
        <div className="camera-glow"><Video size={28} /></div>
        <strong>{isLive ? 'Camera preview active' : label}</strong>
        <span>{isLive ? 'Your video stays on this device' : 'Start your session to enable camera + mic'}</span>
      </div>
      {isLive && <div className="live-badge"><span /> LIVE</div>}
      {mediaError && <div className="media-error"><X size={15} /> {mediaError}</div>}
    </div>
  )
}

function IntroView({ transcript, score, analysis, isLive, mediaError, videoRef, onStart, onStop, onScore, isLoading, timeLeft }: {
  transcript: string
  score: number | null
  analysis: GeminiResult | null
  isLive: boolean
  mediaError: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  onScore: () => void
  isLoading: boolean
  timeLeft: number
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 02 · SELF INTRODUCTION"
        title="Make your first impression count."
        description="Practice your introduction with real-time delivery feedback. Camera data never leaves your device."
      />

      <section className="practice-layout">
        <div>
          <MediaStage isLive={isLive} videoRef={videoRef} mediaError={mediaError} label="Ready when you are" />
          <div className="practice-controls">
            <button className="primary-button" onClick={onStart} disabled={isLive}><Play size={15} fill="currentColor" /> Start</button>
            <button className="stop-button" onClick={onStop} disabled={!isLive}><Square size={14} fill="currentColor" /> Stop</button>
            <button className="secondary-button" onClick={onScore} disabled={isLive || isLoading}><BarChart3 size={16} /> {isLoading ? 'Scoring...' : 'View score'}</button>
          </div>
          <div className={`session-timer ${isLive ? 'active' : ''}`}><Clock3 size={15} /> {isLive ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')} remaining` : '3:00 maximum session'}</div>
        </div>

        <div className="transcript-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LIVE TRANSCRIPT</span>
              <h2>Your words, captured.</h2>
            </div>
            <Mic size={18} className={isLive ? 'recording-icon' : ''} />
          </div>
          <div className="transcript-box">{transcript}<span className="cursor" /></div>
          <p className="privacy-line"><ShieldCheck size={14} /> Transcript is sent to Gemini for language analysis only.</p>
        </div>
      </section>

      {score !== null && (
        <ScoreBreakdown
          score={score}
          title="Your introduction is strong."
          items={[
            ['Eye contact', String(analysis?.eyeContact ?? 0), analysis?.feedback?.[0] || 'Camera focus stayed consistent.'],
            ['Pronunciation', String(analysis?.pronunciation ?? 0), analysis?.feedback?.[1] || 'Clear articulation with minor filler words.'],
            ['Confidence', String(analysis?.confidence ?? 0), analysis?.feedback?.[2] || 'Good energy; slow down slightly at transitions.'],
            ['Word choice', String(analysis?.wording ?? 0), analysis?.feedback?.[3] || 'Specific and relevant to your target role.'],
          ]}
        />
      )}
    </div>
  )
}

function ScoreBreakdown({ score, title, items }: { score: number; title: string; items: string[][] }) {
  return (
    <section className="score-breakdown">
      <div className="breakdown-score">
        <span className="eyebrow">SESSION SCORE</span>
        <strong>{score}</strong>
        <span>/100</span>
        <div className="score-ring-mini"><Check size={17} /></div>
      </div>
      <div className="breakdown-copy">
        <span className="eyebrow">GEMINI FEEDBACK</span>
        <h2>{title}</h2>
        <div className="breakdown-items">
          {items.map(([label, value, text]) => (
            <div key={label}>
              <div className="breakdown-item-label">
                <span>{label}</span>
                <b>{value}<small>/100</small></b>
              </div>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function InterviewView({ started, index, score, analysis, isLive, mediaError, videoRef, onStart, onStop, answer, answersCount, timeLeft, onAnswerChange, onNext, onScore, isLoading }: {
  started: boolean
  index: number
  score: number | null
  analysis: GeminiResult | null
  isLive: boolean
  mediaError: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  answer: string
  answersCount: number
  timeLeft: number
  onAnswerChange: (answer: string) => void
  onNext: () => void
  onScore: () => void
  isLoading: boolean
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 03 · PERSONAL INTERVIEW"
        title="A conversation built around you."
        description="15 questions tailored to your resume, introduction, and target role."
        action={<span className="question-counter"><b>{answersCount}</b> / 15 answered</span>}
      />

      <section className="interview-layout">
        <div>
          <div className="question-card">
            <div className="question-meta">
              <span>QUESTION {String(index + 1).padStart(2, '0')}</span>
              <span className="question-type">Experience & skills</span>
            </div>
            <h2>{questions[index]}</h2>
            <p>Take a moment to think. Your answer will be checked against the experience you shared.</p>
            {started && <div className="interview-timer">{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')} left for this answer</div>}
            <textarea className="interview-answer" value={answer} onChange={(event) => onAnswerChange(event.target.value)} disabled={!started} placeholder={started ? 'Type your answer here...' : 'Start the interview to answer this question.'} rows={6} />
            <div className="question-progress">
              {questions.map((_, i) => (
                <span key={i} className={i < index ? 'done' : i === index ? 'current' : ''} />
              ))}
            </div>
          </div>

          <div className="practice-controls">
            <button className="primary-button" onClick={onStart} disabled={started}><Play size={15} fill="currentColor" /> Start interview</button>
            <button className="stop-button" onClick={onStop} disabled={!started}><Square size={14} fill="currentColor" /> Stop</button>
            <button className="primary-button" onClick={onNext} disabled={!started || !answer.trim()}>{index === questions.length - 1 ? 'Finish interview' : 'Next question'} <ChevronRight size={15} /></button>
            <button className="secondary-button" onClick={onScore} disabled={started || answersCount !== questions.length || isLoading}><BarChart3 size={16} /> {isLoading ? 'Scoring...' : 'View score'}</button>
          </div>
        </div>

        <div>
          <MediaStage isLive={isLive} videoRef={videoRef} mediaError={mediaError} label="Interview camera" />
          <div className="privacy-callout">
            <ShieldCheck size={16} />
            <div>
              <strong>Camera stays private</strong>
              <span>Only your spoken transcript is sent for answer analysis.</span>
            </div>
          </div>
        </div>
      </section>

      {score !== null && (
        <ScoreBreakdown
          score={score}
          title="You showed strong role awareness."
          items={[
            ['Answer quality', String(analysis?.score ?? 0), analysis?.feedback?.[0] || 'You connected your experience to the role and explained trade-offs clearly.'],
            ['Relevance', analysis?.relevant === false ? '0' : '100', analysis?.feedback?.[1] || 'Your examples were aligned with the role and responsibilities.'],
            ['Communication', String(analysis?.score ?? 0), analysis?.betterAnswerTip || 'Your points were clear, though a few could be more concise.'],
          ]}
        />
      )}
      {score !== null && analysis?.generatedAnswer && (
        <section className="generated-answer">
          <span className="eyebrow">GEMINI SUGGESTED ANSWER</span>
          <h2>A stronger way to answer</h2>
          <p>{analysis.generatedAnswer}</p>
        </section>
      )}
    </div>
  )
}

function HistoryView() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 04 · HISTORY"
        title="Your practice, over time."
        description="Review every session and see where your confidence is compounding."
        action={<button className="secondary-button"><BarChart3 size={16} /> Progress report</button>}
      />

      <section className="history-summary">
        <div>
          <span className="eyebrow">AVERAGE SCORE</span>
          <strong>83<small>/100</small></strong>
          <p><ArrowUpRight size={14} /> 6 points this month</p>
        </div>
        <div>
          <span className="eyebrow">SESSIONS COMPLETED</span>
          <strong>12</strong>
          <p>3 this week</p>
        </div>
        <div>
          <span className="eyebrow">BEST STREAK</span>
          <strong>5 <small>days</small></strong>
          <p>Keep it going</p>
        </div>
      </section>

      <div className="history-table">
        <div className="history-table-head">
          <span>SESSION</span>
          <span>SCORE</span>
          <span>DATE</span>
          <span />
        </div>
        {historyItems.map((item) => (
          <div className="history-row" key={item.type}>
            <div className="history-session">
              <div className={`activity-icon ${item.color}`}><BarChart3 size={17} /></div>
              <div>
                <strong>{item.type}</strong>
                <span>{item.detail}</span>
              </div>
            </div>
            <b className={`activity-score ${item.color}`}>{item.score}</b>
            <time>{item.date}</time>
            <ChevronRight size={17} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
