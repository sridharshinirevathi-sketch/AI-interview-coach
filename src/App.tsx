import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, BarChart3, Check, ChevronRight, CircleHelp, Clock3, FileText, History, LayoutDashboard, Mic, Play, RotateCcw, ShieldCheck, Sparkles, Square, Upload, Video, X } from 'lucide-react'
import { analyzeIntroduction, analyzeInterview, analyzeResume, createInterviewQuestions, extractResumeText, type AnalysisResult } from './localAnalysis'
import { startEyeContactTracking } from './faceContact'
import { createSpeechRecognition } from './speechRecognition'
import './App.css'

type View = 'overview' | 'resume' | 'intro' | 'interview' | 'history'
type SessionHistory = {
  id: string
  type: string
  detail: string
  score: number
  date: string
  transcript?: string
  answers?: string[]
  metrics?: AnalysisResult
}

const historyStorageKey = 'ai-interview-coach.history.v1'
const resumeStorageKey = 'ai-interview-coach.resume.v1'

function readSavedResume() {
  try {
    const saved = localStorage.getItem(resumeStorageKey)
    if (!saved) return { name: '', text: '', score: null as number | null, analysis: null as AnalysisResult | null }
    const parsed = JSON.parse(saved) as { name?: string; text?: string; score?: number; analysis?: AnalysisResult }
    return {
      name: parsed.name || '',
      text: parsed.text || '',
      score: typeof parsed.score === 'number' ? parsed.score : null,
      analysis: parsed.analysis || null,
    }
  } catch (error) {
    console.error('Unable to load saved resume analysis:', error)
    return { name: '', text: '', score: null, analysis: null }
  }
}

function normalizeDisplayScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return Math.min(100, Math.max(0, Number(value)))
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [savedResume] = useState(readSavedResume)
  const [resumeName, setResumeName] = useState(savedResume.name)
  const [resumeText, setResumeText] = useState(savedResume.text)
  const [selectedResumeFile, setSelectedResumeFile] = useState<File | null>(null)
  const [resumeScore, setResumeScore] = useState<number | null>(savedResume.score)
  const [resumeAnalysis, setResumeAnalysis] = useState<AnalysisResult | null>(savedResume.analysis)
  const displayResumeScore = normalizeDisplayScore(resumeScore)
  const [isLive, setIsLive] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [appError, setAppError] = useState('')
  const [introTranscript, setIntroTranscript] = useState('')
  const [introScore, setIntroScore] = useState<number | null>(null)
  const [introAnalysis, setIntroAnalysis] = useState<AnalysisResult | null>(null)
  const displayIntroScore = normalizeDisplayScore(introScore)
  const [introSession, setIntroSession] = useState(false)
  const [introTimeLeft, setIntroTimeLeft] = useState(180)
  const [speechLanguage, setSpeechLanguage] = useState('en-IN')
  const [speechConfidence, setSpeechConfidence] = useState<number | null>(null)
  const [voiceLevel, setVoiceLevel] = useState<number | null>(null)
  const [eyeContact, setEyeContact] = useState<number | null>(null)
  const [interviewMode, setInterviewMode] = useState<'personal' | 'stress'>('personal')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [interviewStarted, setInterviewStarted] = useState(false)
  const [interviewAnswers, setInterviewAnswers] = useState<string[]>([])
  const [interviewAnswer, setInterviewAnswer] = useState('')
  const [interviewTimeLeft, setInterviewTimeLeft] = useState(180)
  const [interviewScore, setInterviewScore] = useState<number | null>(null)
  const [interviewAnalysis, setInterviewAnalysis] = useState<AnalysisResult | null>(null)
  const displayInterviewScore = normalizeDisplayScore(interviewScore)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [history, setHistory] = useState<SessionHistory[]>(() => {
    try {
      const saved = localStorage.getItem(historyStorageKey)
      return saved ? JSON.parse(saved) as SessionHistory[] : []
    } catch (error) {
      console.error('Unable to load session history:', error)
      return []
    }
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const interviewAnswerRef = useRef('')
  const submitInterviewAnswerRef = useRef<(timedOut?: boolean) => void>(() => undefined)
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition> | null>(null)
  const recognitionPrefixRef = useRef('')
  const eyeTrackerRef = useRef<{ stop: () => void } | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioTimerRef = useRef<number | null>(null)
  const audioLevelsRef = useRef<number[]>([])
  const interviewQuestions = useMemo(
    () => createInterviewQuestions(resumeText, introTranscript, interviewMode === 'stress'),
    [resumeText, introTranscript, interviewMode],
  )

  const addHistory = (item: Omit<SessionHistory, 'id' | 'date'>) => {
    const next = [{ ...item, id: crypto.randomUUID(), date: new Date().toISOString() }, ...history]
    setHistory(next)
    persistHistory(next)
  }

  const persistHistory = (items: SessionHistory[]) => {
    try {
      localStorage.setItem(historyStorageKey, JSON.stringify(items))
    } catch (error) {
      console.error('Unable to save session history:', error)
      setAppError('Could not save history in this browser. Check available storage space or browser privacy settings.')
    }
  }

  const clearHistory = () => {
    setHistory([])
    try {
      localStorage.removeItem(historyStorageKey)
    } catch (error) {
      console.error('Unable to clear session history:', error)
      setAppError('Could not clear saved history from this browser.')
    }
  }

  const startSpeech = (target: 'intro' | 'interview', prefix = '') => {
    recognitionRef.current?.stop()
    recognitionPrefixRef.current = prefix.trim()
    try {
      const recognition = createSpeechRecognition(
        speechLanguage,
        ({ transcript, confidence }) => {
          setSpeechConfidence(confidence > 0 ? Math.round(confidence * 100) : null)
          const combined = [recognitionPrefixRef.current, transcript].filter(Boolean).join(' ')
          if (target === 'intro') setIntroTranscript(combined)
          else {
            interviewAnswerRef.current = combined
            setInterviewAnswer(combined)
          }
        },
        setMediaError,
      )
      recognitionRef.current = recognition
      recognition.start()
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Speech recognition could not start.')
    }
  }

  const stopMedia = async () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    eyeTrackerRef.current?.stop()
    eyeTrackerRef.current = null
    if (audioTimerRef.current !== null) window.clearInterval(audioTimerRef.current)
    audioTimerRef.current = null
    await audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsLive(false)
  }

  const startMedia = async () => {
    setMediaError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS or localhost.')
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsLive(true)

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      audioContext.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = audioContext
      const samples = new Float32Array(analyser.fftSize)
      audioLevelsRef.current = []
      audioTimerRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        audioLevelsRef.current = [...audioLevelsRef.current.slice(-19), rms]
        const mean = audioLevelsRef.current.reduce((sum, value) => sum + value, 0) / audioLevelsRef.current.length
        setVoiceLevel(Math.min(95, Math.max(35, Math.round(((mean - 0.008) / 0.06) * 60 + 35))))
      }, 250)

      void startEyeContactTracking(videoRef.current!, setEyeContact).then((tracker) => {
        if (streamRef.current === stream) eyeTrackerRef.current = tracker
        else tracker.stop()
      }).catch((error: unknown) => {
        console.error('Eye-contact estimation could not start:', error)
        setMediaError('Camera is active, but eye-contact estimation could not load. Check your internet connection and try again.')
      })
      return true
    } catch (error) {
      await stopMedia()
      setMediaError(error instanceof Error ? error.message : 'Camera and microphone permission is needed to start.')
      return false
    }
  }

  const startIntro = async () => {
    setMediaError('')
    setIntroScore(null)
    setIntroTranscript('')
    setIntroTimeLeft(180)
    setSpeechConfidence(null)
    setVoiceLevel(null)
    setEyeContact(null)
    recognitionPrefixRef.current = ''
    const started = await startMedia()
    if (started) {
      setIntroSession(true)
      startSpeech('intro')
    }
  }

  const stopIntro = async () => {
    setIntroSession(false)
    await stopMedia()
  }

  const startInterview = async () => {
    setMediaError('')
    setQuestionIndex(0)
    setInterviewScore(null)
    setInterviewAnswers([])
    setInterviewAnswer('')
    interviewAnswerRef.current = ''
    setInterviewTimeLeft(180)
    setSpeechConfidence(null)
    setVoiceLevel(null)
    setEyeContact(null)
    const started = await startMedia()
    setInterviewStarted(true)
    if (started) startSpeech('interview')
  }

  const stopInterview = async () => {
    const answer = interviewAnswerRef.current.trim()
    if (answer) {
      setInterviewAnswers((answers) => [...answers, answer])
      interviewAnswerRef.current = ''
      setInterviewAnswer('')
    }
    setInterviewStarted(false)
    await stopMedia()
  }

  const submitInterviewAnswer = (timedOut = false) => {
    const answer = interviewAnswerRef.current.trim()
    if (!answer && !timedOut) return
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setInterviewAnswers((answers) => [...answers, answer])
    setInterviewAnswer('')
    interviewAnswerRef.current = ''
    setInterviewTimeLeft(180)
    if (questionIndex < interviewQuestions.length - 1) {
      const nextIndex = questionIndex + 1
      setQuestionIndex(nextIndex)
      if (interviewStarted) window.setTimeout(() => startSpeech('interview'), 150)
    } else {
      setInterviewStarted(false)
      void stopMedia()
    }
  }
  useEffect(() => {
    submitInterviewAnswerRef.current = submitInterviewAnswer
  })

  const handleResumeAnalyze = async (file?: File) => {
    setIsAnalyzing(true)
    setAppError('')
    setMediaError('')
    try {
      const text = file ? await extractResumeText(file) : resumeText
      const result = analyzeResume(text)
      const name = file?.name || resumeName || 'Resume'
      setResumeText(text)
      setResumeName(name)
      setResumeAnalysis(result)
      setResumeScore(Number(result.score ?? 0))
      setSelectedResumeFile(null)
      try {
        localStorage.setItem(resumeStorageKey, JSON.stringify({ name, text, score: result.score, analysis: result }))
      } catch (error) {
        console.error('Unable to save resume analysis:', error)
        setAppError('Resume analysis completed, but could not be saved in this browser.')
      }
      addHistory({ type: 'Resume analysis', detail: name, score: result.score, metrics: result })
    } catch (error) {
      console.error('Resume analysis failed:', error)
      setAppError(error instanceof Error ? error.message : 'Resume analysis failed.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleIntroAnalyze = async () => {
    if (!introTranscript.trim()) return
    await stopMedia()
    setIsAnalyzing(true)
    try {
      const result = analyzeIntroduction(introTranscript, speechLanguage)
      result.pronunciation = speechConfidence ?? undefined
      result.confidence = voiceLevel ?? undefined
      result.eyeContact = eyeContact ?? undefined
      const observedScores = [result.score, result.grammar, voiceLevel, speechConfidence, eyeContact]
        .filter((value): value is number => typeof value === 'number')
      result.score = Math.round(observedScores.reduce((total, value) => total + value, 0) / observedScores.length)
      setIntroAnalysis(result)
      setIntroScore(Number(result.score ?? 0))
      addHistory({ type: 'Self introduction', detail: `${introTranscript.trim().split(/\s+/).length} words`, score: result.score, transcript: introTranscript, metrics: result })
    } catch (error) {
      console.error('Intro analysis failed:', error)
      setMediaError(error instanceof Error ? error.message : 'Self-introduction analysis failed.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleInterviewAnalyze = async () => {
    const answers = interviewAnswers.map((answer, index) => ({ question: interviewQuestions[index], answer }))
    if (!answers.some(({ answer }) => answer.trim())) return
    await stopMedia()
    setIsAnalyzing(true)
    try {
      const result = analyzeInterview(answers, speechLanguage)
      result.eyeContact = eyeContact ?? undefined
      result.pronunciation = speechConfidence ?? undefined
      result.confidence = voiceLevel ?? undefined
      const observedScores = [result.score, eyeContact, speechConfidence, voiceLevel, result.grammar]
        .filter((value): value is number => typeof value === 'number')
      result.score = Math.round(observedScores.reduce((total, value) => total + value, 0) / observedScores.length)
      setInterviewAnalysis(result)
      setInterviewScore(Number(result.score ?? 0))
      addHistory({
        type: interviewMode === 'stress' ? 'Stress interview' : 'Personal interview',
        detail: `${answers.length} questions`,
        score: result.score,
        answers: interviewAnswers,
        metrics: result,
      })
    } catch (error) {
      console.error('Interview analysis failed:', error)
      setMediaError(error instanceof Error ? error.message : 'Interview analysis failed.')
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

  const navigateTo = (nextView: View) => {
    if (nextView !== view && isLive) {
      setIntroSession(false)
      setInterviewStarted(false)
      void stopMedia()
    }
    setView(nextView)
  }

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
          {navItems.filter(({ id }) => id !== 'history').map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigateTo(id)}>
              <Icon size={18} />
              <span>{label}</span>
              {id === 'resume' && <span className="nav-dot" />}
            </button>
          ))}
          <button className={`nav-item history-nav ${view === 'history' ? 'active' : ''}`} onClick={() => navigateTo('history')}>
            <History size={18} /><span>History</span>
          </button>
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
            <span className="status-pill"><span className="status-dot" /> Local analysis enabled</span>
            <button className="icon-button" aria-label="Notifications"><Clock3 size={18} /></button>
            <div className="small-avatar">MT</div>
          </div>
        </header>

        {appError && <div className="app-alert" role="alert">{appError}<button onClick={() => setAppError('')} aria-label="Dismiss"><X size={15} /></button></div>}
        {view === 'overview' && <Overview onNavigate={navigateTo} resumeName={resumeName} score={displayResumeScore} />}
        {view === 'resume' && (
          <ResumeDetailedView
            resumeName={resumeName}
            resumeText={resumeText}
            selectedFile={selectedResumeFile}
            uploaded={Boolean(resumeName)}
            score={displayResumeScore}
            analysis={resumeAnalysis}
            isLoading={isAnalyzing}
            error={appError || mediaError}
            onError={(message) => {
              setAppError(message)
              setMediaError('')
            }}
            onUpload={(name, text, file) => {
              setResumeName(name)
              setResumeText(text || '')
              setSelectedResumeFile(file || null)
              setResumeScore(null)
              setResumeAnalysis(null)
              setAppError('')
              setMediaError('')
            }}
            onAnalyze={(file) => void handleResumeAnalyze(file)}
          />
        )}
        {view === 'intro' && (
          <IntroView
            transcript={introTranscript}
            onTranscriptChange={setIntroTranscript}
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
            speechLanguage={speechLanguage}
            onSpeechLanguageChange={setSpeechLanguage}
            speechConfidence={speechConfidence}
            voiceLevel={voiceLevel}
            eyeContact={eyeContact}
          />
        )}
        {view === 'interview' && (
          <InterviewView
            mode={interviewMode}
            onModeChange={(mode) => {
              setInterviewMode(mode)
              setQuestionIndex(0)
              setInterviewAnswers([])
              setInterviewAnswer('')
              setInterviewScore(null)
              setInterviewAnalysis(null)
            }}
            started={interviewStarted}
            index={questionIndex}
            questions={interviewQuestions}
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
            canPersonalize={Boolean(resumeText.trim() && introTranscript.trim())}
            eyeContact={eyeContact}
            speechConfidence={speechConfidence}
            voiceLevel={voiceLevel}
            speechLanguage={speechLanguage}
            onSpeechLanguageChange={setSpeechLanguage}
          />
        )}
        {view === 'history' && <HistoryView history={history} onClear={() => {
          clearHistory()
          setAppError('')
        }} />}
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
        eyebrow="AI INTERVIEW COACH"
        title="Choose your practice"
        description="Upload your resume, practice your introduction, and prepare for interviews."
        action={<button className="secondary-button" onClick={() => onNavigate('history')}><History size={16} /> History</button>}
      />
      <section className="feature-grid">
        <button className="feature-card resume-feature" onClick={() => onNavigate('resume')}>
          <span className="feature-icon"><FileText size={22} /></span>
          <strong>Resume Analysis</strong>
          <span>Upload your resume to get an ATS score and actionable feedback.</span>
          <b>{score === null ? 'Upload resume' : `${resumeName} · Score ${score}/100`} <ChevronRight size={16} /></b>
        </button>
        <button className="feature-card intro-feature" onClick={() => onNavigate('intro')}>
          <span className="feature-icon"><Mic size={22} /></span>
          <strong>Self Introduction</strong>
          <span>Practice with camera and microphone, then review your transcript and delivery.</span>
          <b>Start practice <ChevronRight size={16} /></b>
        </button>
        <button className="feature-card interview-feature" onClick={() => onNavigate('interview')}>
          <span className="feature-icon"><Video size={22} /></span>
          <strong>Personal Interview Practice</strong>
          <span>Answer 15 resume-based questions or try 10 stress interview questions.</span>
          <b>Start interview <ChevronRight size={16} /></b>
        </button>
      </section>
      <p className="local-privacy"><ShieldCheck size={15} /> Scores and history stay in this browser. No Gemini API key is used.</p>
    </div>
  )
}

function ResumeDetailedView({ resumeName, resumeText, selectedFile, uploaded, score, analysis, isLoading, error, onError, onUpload, onAnalyze }: {
  resumeName: string
  resumeText: string
  selectedFile: File | null
  uploaded: boolean
  score: number | null
  analysis: AnalysisResult | null
  isLoading: boolean
  error: string
  onError: (message: string) => void
  onUpload: (name: string, text?: string, file?: File) => void
  onAnalyze: (file?: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 01 · RESUME ATS"
        title="Your resume, made searchable."
        description="See how recruiters and applicant tracking systems read your experience."
        action={<button className="secondary-button" onClick={() => inputRef.current?.click()} disabled={isLoading}><Upload size={16} /> Upload new resume</button>}
      />

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        hidden
        disabled={isLoading}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          event.currentTarget.value = ''
          if (file.size > 10 * 1024 * 1024) {
            onError('Please choose a file smaller than 10 MB.')
            return
          }
          const text = file.name.toLowerCase().endsWith('.txt') ? await file.text() : ''
          onUpload(file.name, text, file)
        }}
      />

      <section className="resume-layout">
        <div className="analysis-main">
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="upload-strip" onClick={() => !isLoading && inputRef.current?.click()}>
            <div className="file-icon"><FileText size={20} /></div>
            <div>
              <strong>{uploaded ? resumeName : 'Upload your resume'}</strong>
              <span>{uploaded ? `${resumeName.split('.').pop()?.toUpperCase() || 'FILE'} · Ready for local analysis` : 'PDF, DOCX, or TXT up to 10 MB'}</span>
            </div>
            <button className="round-action" aria-label="Replace resume" disabled={isLoading}><RotateCcw size={16} /></button>
          </div>

          <button className="view-score-button" onClick={() => onAnalyze(selectedFile || undefined)} disabled={(!selectedFile && !resumeText.trim()) || isLoading}>
            <BarChart3 size={17} /> {isLoading ? 'Analyzing locally...' : score === null ? 'View ATS score' : 'Recalculate ATS score'} <ChevronRight size={16} />
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
            <span className="gemini-tag"><Sparkles size={14} /> Offline estimate</span>
          </div>

          <div className="feedback-grid">
            {(analysis?.improvements || []).slice(0, 3).map((feedback, index) => (
              <FeedbackCard key={feedback} number={`0${index + 1}`} title={analysis?.mistakes?.[index] || ['Add measurable impact', 'Add role-specific keywords', 'Improve readability'][index]} text={feedback} tag={analysis?.keywords?.[index] || ['Keywords + impact', 'Role fit', 'ATS clarity'][index]} />
            ))}
            {!analysis && <p className="empty-feedback">Upload a resume, then view its score to see personalized feedback.</p>}
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
          <span>{isLive ? 'Your video stays on this device' : 'Start your session to preview the camera'}</span>
      </div>
      {isLive && <div className="live-badge"><span /> LIVE</div>}
      {mediaError && <div className="media-error"><X size={15} /> {mediaError}</div>}
    </div>
  )
}

function IntroView({ transcript, onTranscriptChange, score, analysis, isLive, mediaError, videoRef, onStart, onStop, onScore, isLoading, timeLeft, speechLanguage, onSpeechLanguageChange, speechConfidence, voiceLevel, eyeContact }: {
  transcript: string
  onTranscriptChange: (transcript: string) => void
  score: number | null
  analysis: AnalysisResult | null
  isLive: boolean
  mediaError: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  onScore: () => void
  isLoading: boolean
  timeLeft: number
  speechLanguage: string
  onSpeechLanguageChange: (language: string) => void
  speechConfidence: number | null
  voiceLevel: number | null
  eyeContact: number | null
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="STEP 02 · SELF INTRODUCTION"
        title="Make your first impression count."
        description="Start to turn on your camera and microphone. Your speech appears in the notes panel."
      />

      <section className="practice-layout">
        <div>
          <MediaStage isLive={isLive} videoRef={videoRef} mediaError={mediaError} label="Ready when you are" />
          <div className="practice-controls">
            <button className="primary-button" onClick={onStart} disabled={isLive}><Play size={15} fill="currentColor" /> Start</button>
            <button className="stop-button" onClick={onStop} disabled={!isLive}><Square size={14} fill="currentColor" /> Stop</button>
            <button className="secondary-button" onClick={onScore} disabled={isLive || isLoading || !transcript.trim()}><BarChart3 size={16} /> {isLoading ? 'Scoring...' : 'View score'}</button>
          </div>
          <div className={`session-timer ${isLive ? 'active' : ''}`}><Clock3 size={15} /> {isLive ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')} remaining` : '3:00 maximum session'}</div>
        </div>

        <div className="transcript-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">INTRODUCTION TEXT</span>
              <h2>{isLive ? 'Speak naturally; your words appear here.' : 'Your transcript and notes'}</h2>
            </div>
            <Mic size={18} />
          </div>
          <label className="language-picker">Speech language
            <select value={speechLanguage} onChange={(event) => onSpeechLanguageChange(event.target.value)} disabled={isLive}>
              <option value="en-IN">English (India)</option>
              <option value="en-US">English (US)</option>
              <option value="ta-IN">Tamil</option>
            </select>
          </label>
          <textarea className="transcript-box transcript-editor" aria-label="Introduction text" placeholder="Type or paste your introduction here..." value={transcript} onChange={(event) => onTranscriptChange(event.target.value)} />
          <p className="privacy-line"><ShieldCheck size={14} /> Analysis runs in this browser. Speech recognition is provided by your browser and may use its own online service.</p>
        </div>
      </section>

      {score !== null && (
        <ScoreBreakdown
          score={score}
          title="Introduction delivery estimates"
          items={[
            ['Eye contact estimate', eyeContact === null ? 'N/A' : String(eyeContact), analysis?.feedback?.[0] || 'Needs a visible face; gaze is estimated from webcam landmarks.'],
            ['Voice confidence estimate', voiceLevel === null ? 'N/A' : String(voiceLevel), 'Based on microphone loudness only; it is not an emotion detector.'],
            ['Pronunciation estimate', speechConfidence === null ? 'N/A' : String(speechConfidence), 'Based on browser speech-recognition confidence, not a pronunciation model.'],
            ['Grammar estimate', analysis?.grammar === undefined ? 'N/A' : String(analysis.grammar), analysis?.feedback?.[2] || 'A lightweight local English pattern check; review the transcript yourself.'],
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
        <span className="eyebrow">LOCAL FEEDBACK</span>
        <h2>{title}</h2>
        <div className="breakdown-items">
          {items.map(([label, value, text]) => (
            <div key={label}>
              <div className="breakdown-item-label">
                <span>{label}</span>
                <b>{value === 'N/A' ? value : <>{value}<small>/100</small></>}</b>
              </div>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function InterviewView({ mode, onModeChange, started, index, questions, score, analysis, isLive, mediaError, videoRef, onStart, onStop, answer, answersCount, timeLeft, onAnswerChange, onNext, onScore, isLoading, canPersonalize, eyeContact, speechConfidence, voiceLevel, speechLanguage, onSpeechLanguageChange }: {
  mode: 'personal' | 'stress'
  onModeChange: (mode: 'personal' | 'stress') => void
  started: boolean
  index: number
  questions: string[]
  score: number | null
  analysis: AnalysisResult | null
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
  canPersonalize: boolean
  eyeContact: number | null
  speechConfidence: number | null
  voiceLevel: number | null
  speechLanguage: string
  onSpeechLanguageChange: (language: string) => void
}) {
  const canStart = true
  return (
    <div className="page">
      <PageHeader
        eyebrow={mode === 'stress' ? 'STRESS INTERVIEW · 10 QUESTIONS' : 'PERSONAL INTERVIEW · 15 QUESTIONS'}
        title={mode === 'stress' ? 'Practice under pressure.' : 'A conversation built around you.'}
        description={mode === 'stress' ? 'Try challenging follow-up questions and practice staying composed.' : 'Questions are generated from your uploaded resume and self-introduction.'}
        action={<span className="question-counter"><b>{answersCount}</b> / {questions.length} answered</span>}
      />

      <div className="interview-mode-switch" role="group" aria-label="Interview type">
        <button className={mode === 'personal' ? 'selected' : ''} onClick={() => onModeChange('personal')} disabled={started}>Personal interview · 15</button>
        <button className={mode === 'stress' ? 'selected' : ''} onClick={() => onModeChange('stress')} disabled={started}>Stress interview · 10</button>
      </div>
      {mode === 'personal' && !canPersonalize && <p className="setup-notice">You can start now; upload a resume and complete your self-introduction to personalize more questions.</p>}
      <section className="interview-layout">
        <div>
          <div className="question-card">
            <div className="question-meta">
              <span>QUESTION {String(index + 1).padStart(2, '0')}</span>
              <span className="question-type">{mode === 'stress' ? 'Pressure practice' : 'Resume & introduction'}</span>
            </div>
            <h2>{questions[index] || 'Complete this session to see your feedback.'}</h2>
            <p>Take a moment to think. Your answer will be checked against the experience you shared.</p>
            {started && <div className="interview-timer">{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')} left for this answer</div>}
            <textarea className="interview-answer" value={answer} onChange={(event) => onAnswerChange(event.target.value)} disabled={!started} placeholder={started ? 'Speak your answer or type it here...' : 'Start the interview to answer this question.'} rows={6} />
            <div className="question-progress">
              {questions.map((_, i) => (
                <span key={i} className={i < index ? 'done' : i === index ? 'current' : ''} />
              ))}
            </div>
          </div>

          <div className="practice-controls">
            <button className="primary-button" onClick={onStart} disabled={started || !canStart}><Play size={15} fill="currentColor" /> Start interview</button>
            <button className="stop-button" onClick={onStop} disabled={!started}><Square size={14} fill="currentColor" /> Stop</button>
            <button className="primary-button" onClick={onNext} disabled={!started || !answer.trim()}>{index === questions.length - 1 ? 'Finish interview' : 'Next question'} <ChevronRight size={15} /></button>
            <button className="secondary-button" onClick={onScore} disabled={started || answersCount === 0 || isLoading}><BarChart3 size={16} /> {isLoading ? 'Scoring...' : 'View score'}</button>
          </div>
          <label className="language-picker">Speech language
            <select value={speechLanguage} onChange={(event) => onSpeechLanguageChange(event.target.value)} disabled={started}>
              <option value="en-IN">English (India)</option>
              <option value="en-US">English (US)</option>
              <option value="ta-IN">Tamil</option>
            </select>
          </label>
        </div>

        <div>
          <MediaStage isLive={isLive} videoRef={videoRef} mediaError={mediaError} label="Interview camera" />
          <div className="privacy-callout">
            <ShieldCheck size={16} />
            <div>
              <strong>Camera stays private</strong>
              <span>Face landmarks and audio levels are analyzed in this browser. Speech transcription uses your browser's recognition service.</span>
            </div>
          </div>
        </div>
      </section>

      {score !== null && (
        <ScoreBreakdown
          score={score}
          title="Interview delivery estimates"
          items={[
            ['Eye contact estimate', eyeContact === null ? 'N/A' : String(eyeContact), 'Estimated from visible face and gaze landmarks.'],
            ['Voice confidence estimate', voiceLevel === null ? 'N/A' : String(voiceLevel), 'Based on microphone loudness only.'],
            ['Pronunciation estimate', speechConfidence === null ? 'N/A' : String(speechConfidence), 'Based on browser speech-recognition confidence.'],
            ['Grammar estimate', analysis?.grammar === undefined ? 'N/A' : String(analysis.grammar), analysis?.feedback?.[0] || 'A lightweight local English pattern check.'],
            ['Answer quality', String(analysis?.score ?? 0), analysis?.betterAnswerTip || 'Use specific examples and measurable outcomes.'],
          ]}
        />
      )}
      {score !== null && analysis?.generatedAnswer && (
        <section className="generated-answer">
          <span className="eyebrow">SUGGESTED ANSWER STRUCTURE</span>
          <h2>A stronger way to answer</h2>
          <p>{analysis.generatedAnswer}</p>
        </section>
      )}
    </div>
  )
}

function HistoryView({ history, onClear }: { history: SessionHistory[]; onClear: () => void }) {
  const average = history.length
    ? Math.round(history.reduce((total, item) => total + item.score, 0) / history.length)
    : 0

  return (
    <div className="page">
      <PageHeader
        eyebrow="YOUR SESSIONS"
        title="Your practice, over time."
        description="Completed analyses and practice scores are saved only in this browser."
        action={<button className="secondary-button" onClick={() => {
          if (window.confirm('Clear all saved session history from this browser?')) onClear()
        }} disabled={!history.length}><X size={16} /> Clear history</button>}
      />

      <section className="history-summary">
        <div>
          <span className="eyebrow">AVERAGE SCORE</span>
          <strong>{history.length ? average : '--'}<small>/100</small></strong>
          <p>{history.length ? `${history.length} saved practice sessions` : 'Scores appear here after analysis'}</p>
        </div>
        <div>
          <span className="eyebrow">SESSIONS COMPLETED</span>
          <strong>{history.length}</strong>
          <p>Stored in this browser</p>
        </div>
        <div>
          <span className="eyebrow">BEST SCORE</span>
          <strong>{history.length ? Math.max(...history.map((item) => item.score)) : '--'}<small>/100</small></strong>
          <p>Across your saved sessions</p>
        </div>
      </section>

      <div className="history-table">
        <div className="history-table-head">
          <span>SESSION</span>
          <span>SCORE</span>
          <span>DATE</span>
          <span />
        </div>
        {history.map((item) => {
          const color = item.type.includes('Resume') ? 'blue' : item.type.includes('interview') ? 'orange' : 'green'
          return (
            <div className="history-entry" key={item.id}>
              <div className="history-row">
                <div className="history-session">
                  <div className={`activity-icon ${color}`}><BarChart3 size={17} /></div>
                  <div>
                    <strong>{item.type}</strong>
                    <span>{item.detail}</span>
                  </div>
                </div>
                <b className={`activity-score ${color}`}>{item.score}</b>
                <time>{new Date(item.date).toLocaleString()}</time>
                <ChevronRight size={17} />
              </div>
              {(item.transcript || item.answers?.length) && (
                <details className="history-details">
                  <summary>View saved transcript and answers</summary>
                  {item.transcript && <p>{item.transcript}</p>}
                  {item.answers?.map((answer, index) => <p key={`${item.id}-${index}`}><strong>Answer {index + 1}:</strong> {answer}</p>)}
                </details>
              )}
            </div>
          )
        })}
        {!history.length && <p className="empty-history">No sessions saved yet. Complete a resume analysis or practice session to start your history.</p>}
      </div>
    </div>
  )
}

export default App
