import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleCheck, Clock3, Compass, Download, Flame, GraduationCap, Lightbulb, ListChecks,
  LockKeyhole, Moon, PanelLeftClose, PanelLeftOpen, Power, RotateCcw, Search, Settings,
  Sparkles, Sun, Target, Type, Volume2, X
} from 'lucide-react'
import { loadPreferences, savePreferences } from '../preferences.js'
import course from '../../../course/course-v1.json'
import {
  createInitialProgress, getCourseStats, getDueCards, getFlashcards, getLessons, getRatingIntervals,
  getRetrievalPrompt, markLessonComplete, normalizeProgress, rateCard, saveLessonSession, saveMilestone, shouldShowRomaji
} from '../learning.js'
import { kanaToRomaji } from '../romaji.js'
import LessonSpeakingPractice from './asr/LessonSpeakingPractice.jsx'
import { useTts } from './tts/useTts.js'
import VoiceLabPage from './tts/VoiceLabPage.jsx'
import { getLessonSpeechTargets, getTtsEngineReadiness, isJapanesePracticeText } from './tts/readiness.js'

const STORAGE_KEY = 'kanafish-progress-v1'
const todayISO = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}
const labelSpeaker = (speaker) => ({
  staff: 'Staff', traveller: 'You', travellerA: 'Traveller A', travellerB: 'Traveller B',
  guest: 'Guest', host: 'Host', visitor: 'Visitor', friend: 'Friend', guide: 'Guide',
  clerk: 'Clerk', waiter: 'Server', customer: 'Customer', stationStaff: 'Station staff'
}[speaker] || speaker.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))

function loadProgress() {
  try {
    return normalizeProgress(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'))
  } catch {
    return createInitialProgress()
  }
}

function getLocalStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function App() {
  const [preferences, setPreferences] = useState(() => loadPreferences(getLocalStorage()))
  const [progress, setProgress] = useState(loadProgress)
  const tts = useTts(preferences.supertonicVoice)
  const progressRef = useRef(progress)
  const [persistenceError, setPersistenceError] = useState('')
  const [view, setView] = useState('today')
  const [selectedLessonId, setSelectedLessonId] = useState(null)
  const [search, setSearch] = useState('')
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set([1]))
  const lessons = useMemo(() => getLessons(course), [])
  const cards = useMemo(() => getFlashcards(course), [])
  const stats = useMemo(() => getCourseStats(course, progress), [progress])
  const availableWeek = stats.nextLesson?.week ?? course.durationWeeks
  const dueCards = useMemo(() => getDueCards(cards, progress, todayISO(), 500)
    .filter((card) => card.week <= availableWeek).slice(0, 8), [cards, progress, availableWeek])
  const selected = lessons.find(({ lesson }) => lesson.id === selectedLessonId)
  const selectedWeek = selected ? course.weeks.find((week) => week.week === selected.week) : null

  useEffect(() => {
    if (view !== 'lesson') tts.stopPlayback()
  }, [view, tts.stopPlayback])

  useEffect(() => {
    if (!['course', 'review', 'phrasebook'].includes(view) || !tts.activeEngineStatus?.ready) return
    void tts.prewarm?.().catch(() => {})
  }, [view, tts.activeEngineStatus?.ready, tts.prewarm])

  function updateProgress(next) {
    const resolved = typeof next === 'function' ? next(progressRef.current) : next
    progressRef.current = resolved
    setProgress(resolved)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved))
      setPersistenceError('')
    } catch {
      setPersistenceError('This change could not be saved on this device. It will remain in memory only until Kanafish closes; export a copy before closing.')
    }
  }

  function openLesson(lessonId) {
    setSelectedLessonId(lessonId)
    setView('lesson')
    const current = progress.lessonSessions[lessonId] || {}
    if (!current.startedAt) {
      updateProgress((state) => saveLessonSession(state, lessonId, { startedAt: new Date().toISOString(), step: 0 }))
    }
  }

  function patchLesson(patch) {
    if (!selectedLessonId) return
    updateProgress((state) => saveLessonSession(state, selectedLessonId, patch))
  }

  function navigate(nextView) {
    setView(nextView)
    setSelectedLessonId(null)
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify({ app: 'Kanafish', version: 2, exportedAt: new Date().toISOString(), progress: progressRef.current }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `kanafish-progress-${todayISO()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  function updatePreferences(patch) {
    setPreferences(savePreferences(getLocalStorage(), { ...preferences, ...patch }))
  }

  return (
    <div className="app-shell" data-platform={window.kanafish?.platform || 'web'} data-theme={preferences.theme} style={{ '--text-scale': preferences.textScale }}>
      <aside className={`sidebar ${preferences.sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="sidebar-titlebar" aria-hidden="true" />
        <div className="brand-lockup">
          <div className="brand-mark"><span>か</span><span>な</span></div>
          <div className="brand-copy"><strong>Kanafish</strong><small>Beginner · 12 weeks</small></div>
        </div>
        <nav id="primary-nav" className="primary-nav" aria-label="Main navigation">
          <NavButton icon={<CalendarDays size={16} />} label="Today" active={view === 'today'} onClick={() => navigate('today')} />
          <NavButton icon={<Compass size={16} />} label="Course path" active={view === 'course'} onClick={() => navigate('course')} />
          <NavButton icon={<RotateCcw size={16} />} label="Review cards" active={view === 'review'} onClick={() => navigate('review')} badge={dueCards.length || null} />
          <NavButton icon={<BookOpen size={16} />} label="Phrasebook" active={view === 'phrasebook'} onClick={() => navigate('phrasebook')} />
          <NavButton icon={<Volume2 size={16} />} label="Voice Lab" active={view === 'voice-lab'} onClick={() => navigate('voice-lab')} />
          <NavButton icon={<Target size={16} />} label="Milestones" active={view === 'milestones'} onClick={() => navigate('milestones')} />
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-progress" title={`${stats.completedLessons} of ${stats.totalLessons} lessons complete`}>
          <div className="sidebar-progress-top"><span>Progress</span><strong>{stats.completedLessons}/{stats.totalLessons}</strong></div>
          <ProgressBar value={stats.percent} />
        </div>
        <div className="sidebar-footer" role="group" aria-label="App actions">
          <button type="button" className="sidebar-footer-icon-button sidebar-collapse-button" onClick={() => updatePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })} aria-label={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!preferences.sidebarCollapsed} aria-controls="primary-nav" title={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {preferences.sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button type="button" className={`sidebar-footer-icon-button ${view === 'settings' ? 'is-current' : ''}`} onClick={() => navigate('settings')} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} title="Settings"><Settings size={16} /></button>
          <button type="button" className="sidebar-footer-icon-button sidebar-quit-button" onClick={() => window.kanafish?.exitApp?.()} aria-label="Quit Kanafish" title="Quit Kanafish"><Power size={16} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Japanese travel course</span><ChevronRight size={14} /><strong>{viewTitle(view, selected?.lesson)}</strong></div>
          <div className="topbar-right"><span className="offline-pill"><span /> On-device speech · optional</span><span className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span></div>
        </header>
        {persistenceError && <div className="save-warning" role="alert"><span>{persistenceError}</span><button onClick={exportProgress}><Download size={14} /> Export progress</button></div>}
        {tts.error && <div className="tts-app-error" role="alert"><span>Local speech: {tts.error}</span><button type="button" onClick={tts.clearError}>Dismiss</button></div>}
        {(tts.busy || tts.isPlaying) && <div className="tts-audio-active" role="status"><span><Volume2 size={14} /> {tts.isPlaying ? 'Playing local Japanese audio…' : 'Preparing local Japanese speech…'}</span><button type="button" onClick={tts.stopPlayback}>Stop audio</button></div>}
        <div className={`page-content ${view === 'lesson' ? 'page-content-lesson' : ''}`}>
          {view === 'today' && <TodayPage course={course} stats={stats} dueCount={dueCards.length} onOpenLesson={openLesson} onReview={() => navigate('review')} onCourse={() => navigate('course')} progress={progress} />}
          {view === 'course' && <CoursePage weeks={course.weeks} progress={progress} romajiMode={preferences.romajiMode} expandedWeeks={expandedWeeks} setExpandedWeeks={setExpandedWeeks} onOpenLesson={openLesson} tts={tts} onOpenVoiceLab={() => setView('voice-lab')} />}
          {view === 'lesson' && selected && selectedWeek && <LessonPage key={selected.lesson.id} week={selectedWeek} lesson={selected.lesson} course={course} progress={progress} tts={tts} onPatch={patchLesson} onComplete={() => {
            updateProgress((state) => markLessonComplete(state, selected.lesson.id, todayISO()))
            setView('today')
            setSelectedLessonId(null)
          }} onRateCard={(card, rating) => updateProgress((state) => rateCard(state, card.id, rating, todayISO(), card))} romajiMode={preferences.romajiMode} onBack={() => navigate('course')} onOpenVoiceLab={() => setView('voice-lab')} />}
          {view === 'review' && <ReviewPage cards={dueCards} progress={progress} romajiMode={preferences.romajiMode} onRate={(card, rating) => updateProgress((state) => rateCard(state, card.id, rating, todayISO(), card))} onPhrasebook={() => navigate('phrasebook')} tts={tts} onOpenVoiceLab={() => setView('voice-lab')} />}
          {view === 'phrasebook' && <PhrasebookPage cards={cards} search={search} setSearch={setSearch} progress={progress} romajiMode={preferences.romajiMode} tts={tts} onOpenVoiceLab={() => setView('voice-lab')} />}
          {view === 'voice-lab' && <VoiceLabPage tts={tts} voiceSettings={preferences.supertonicVoice} onVoiceSettingsChange={(supertonicVoice) => updatePreferences({ supertonicVoice })} />}
          {view === 'milestones' && <MilestonesPage weeks={course.weeks} progress={progress} onSave={(id, patch) => updateProgress((state) => saveMilestone(state, id, patch))} />}
          {view === 'settings' && <SettingsPage theme={preferences.theme} textScale={preferences.textScale} romajiMode={preferences.romajiMode} onThemeChange={(theme) => updatePreferences({ theme })} onTextScaleChange={(textScale) => updatePreferences({ textScale })} onRomajiModeChange={(romajiMode) => updatePreferences({ romajiMode })} onExport={exportProgress} />}
        </div>
      </main>
    </div>
  )
}

function NavButton({ icon, label, active, onClick, badge }) {
  return <button type="button" className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined} title={label}>{icon}<span>{label}</span>{badge ? <em>{badge}</em> : null}</button>
}

function SpeechButton({ text, tts, label, className = '', compact = false, rate = 1, voiceContext }) {
  const readiness = tts?.activeEngineStatus || getTtsEngineReadiness(tts?.activeModelId)
  const disabled = !text?.trim() || !readiness?.ready || tts?.busy
  const accessibleLabel = label || `Listen to ${text}`
  const title = readiness?.ready
    ? `${readiness.modelName} · ${rate < 1 ? `${rate}× slower` : 'normal speed'}`
    : readiness?.message || 'Check local speech setup in Voice Lab.'
  return <button type="button" className={`speech-button ${compact ? 'speech-button-compact' : ''} ${className}`.trim()} onClick={() => void tts.playText(text, { rate, ...voiceContext }).catch(() => {})} disabled={disabled} aria-label={accessibleLabel} title={title}>
    <Volume2 size={14} />{!compact && <span>Listen</span>}
  </button>
}

function RomajiText({ text, progress, mode = 'adaptive' }) {
  const romaji = kanaToRomaji(text)
  if (!romaji || !shouldShowRomaji(text, progress, mode)) return null
  return <small className="romaji-line" lang="ja-Latn">{romaji}</small>
}

function SpeechSetupNote({ tts, onOpenVoiceLab }) {
  const readiness = tts?.activeEngineStatus
  if (readiness?.ready) return null
  return <div className="speech-setup-note" role="status">
    <span><Volume2 size={15} /> {readiness?.message || 'Checking the selected local Japanese voice…'}</span>
    <button type="button" className="text-link" onClick={onOpenVoiceLab}>Open Voice Lab <ArrowRight size={13} /></button>
  </div>
}

function ProgressBar({ value }) {
  return <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div>
}

function viewTitle(view, lesson) {
  if (view === 'lesson') return lesson?.title || 'Lesson'
  return ({ today: 'Today', course: 'Course path', review: 'Review cards', phrasebook: 'Phrasebook', 'voice-lab': 'Voice Lab', milestones: 'Milestones', settings: 'Settings' })[view] || 'Today'
}

function TodayPage({ course, stats, dueCount, onOpenLesson, onReview, onCourse, progress }) {
  const next = stats.nextLesson
  const nextLessonId = next?.lesson?.id
  const week = next ? course.weeks.find((item) => item.week === next.week) : null
  const completed = stats.completedLessons === stats.totalLessons
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const startedCount = Object.keys(progress.lessonSessions || {}).length
  const milestone = stats.milestones.find((item) => !item.completed)
  return (
    <div className="today-page page-enter">
      <div className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR DAILY PRACTICE</div><h1>{greeting}, learner<span className="title-period">.</span></h1><p className="welcome-subtitle">A small conversation today makes the next one easier.</p></div>
        <div className="streak-card"><div className="streak-icon"><Flame size={19} /></div><div><strong>{progress.lastStudyDate === todayISO() ? 'Practised today' : 'A good day to start'}</strong><small>{startedCount ? `${startedCount} lesson${startedCount === 1 ? '' : 's'} opened so far` : 'Your first session is ready'}</small></div></div>
      </div>
      <div className="today-grid">
        <section className="feature-card lesson-feature">
          <div className="feature-topline"><span className="badge badge-dark"><Sparkles size={13} /> NEXT IN YOUR COURSE</span><span className="duration"><Clock3 size={14} /> 12–20 min</span></div>
          {completed ? <>
            <div className="lesson-number">COURSE COMPLETE</div><h2>You’ve worked through all 36 lessons.</h2><p>Return to review cards or revisit any scene when you want to keep practising.</p><button className="primary-button" onClick={onReview}>Review useful phrases <ArrowRight size={16} /></button>
          </> : <>
            <div className="lesson-number">WEEK {String(week.week).padStart(2, '0')} <span>·</span> LESSON {next.lesson.id.split('-L')[1]}</div><h2>{next.lesson.title}</h2><p>{week.canDo}</p>
            <div className="lesson-scene"><span className="scene-icon"><Compass size={17} /></span><span>{next.lesson.scene}</span></div>
            <button className="primary-button" onClick={() => onOpenLesson(nextLessonId)}>{progress.lessonSessions[nextLessonId]?.startedAt ? 'Continue lesson' : 'Start today’s lesson'} <ArrowRight size={16} /></button>
          </>}
          <div className="feature-decoration"><span>あ</span><span>話</span></div>
        </section>
        <section className="daily-stack">
          <button className="review-card" onClick={onReview}>
            <div className="review-card-icon"><RotateCcw size={18} /></div><div className="review-card-body"><span className="eyebrow">SPACED RETRIEVAL</span><strong>{dueCount ? `${dueCount} cards in a short review` : 'Your review queue is clear'}</strong><small>{dueCount ? 'A small daily set, drawn from lessons you have unlocked.' : 'Start a lesson to build your personal review deck.'}</small></div><ArrowRight size={17} className="review-arrow" />
          </button>
          <div className="weekly-card"><div className="section-heading compact-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h3>Steady progress</h3></div><span className="weekly-ring">{stats.percent}%</span></div><ProgressBar value={stats.percent} /><div className="weekly-stats"><div><strong>{stats.completedLessons}<span>/{stats.totalLessons}</span></strong><small>lessons</small></div><div><strong>{stats.completedWeeks}<span>/{stats.totalWeeks}</span></strong><small>weeks</small></div><div><strong>{stats.milestones.filter((item) => item.completed).length}<span>/{stats.milestones.length}</span></strong><small>checkpoints</small></div></div><button className="text-link" onClick={onCourse}>View your course path <ArrowRight size={14} /></button></div>
        </section>
      </div>
      <div className="lower-grid">
        <section className="panel next-step-panel"><div className="section-heading"><div><span className="eyebrow">UP NEXT</span><h3>{milestone ? milestone.title : 'The whole course is yours to revisit'}</h3></div><span className="round-icon"><Target size={17} /></span></div><p>{milestone ? milestone.task : 'Review any scene, revisit your phrasebook, or practise a milestone at your own pace.'}</p><div className="panel-foot"><span className="soft-tag"><CircleCheck size={14} /> Learner-recorded evidence</span><span className="muted-caption">No automatic fluency score</span></div></section>
        <section className="panel daily-note-panel"><div className="note-ornament"><Lightbulb size={18} /></div><div><span className="eyebrow">A GOOD HABIT</span><h3>Try before you peek.</h3><p>Recall a phrase first. Then use the cue, phrase bank, or meaning reveal whenever it helps.</p></div></section>
      </div>
      <div className="today-footer"><span>Text-first by design</span><span className="footer-dot" /> Kana, meanings, and partner prompts — no audio required.</div>
    </div>
  )
}

function CoursePage({ weeks, progress, romajiMode, expandedWeeks, setExpandedWeeks, onOpenLesson, tts, onOpenVoiceLab }) {
  const completed = progress.completedLessonIds || []
  const toggle = (week) => setExpandedWeeks((current) => {
    const next = new Set(current)
    if (next.has(week)) next.delete(week); else next.add(week)
    return next
  })
  const total = weeks.reduce((sum, week) => sum + week.lessons.length, 0)
  const done = completed.length
  return (
    <div className="content-page page-enter">
      <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> THE 12-WEEK ROUTE</div><h1>Course path<span className="title-period">.</span></h1><p>Thirty-six short lessons, moving from useful phrases to more flexible travel conversations.</p></div>
      <div className="course-overview"><div className="course-overview-mark"><GraduationCap size={23} /></div><div className="course-overview-copy"><strong>Japanese Travel & Conversation</strong><span>Beginner · 12 weeks · 3 lessons per week</span></div><div className="course-overview-progress"><strong>{done}<span>/{total}</span></strong><small>lessons practised</small></div><div className="course-overview-meter"><ProgressBar value={total ? (done / total) * 100 : 0} /></div></div>
      <SpeechSetupNote tts={tts} onOpenVoiceLab={onOpenVoiceLab} />
      <div className="week-list">
        {weeks.map((week, weekIndex) => {
          const firstLessonNumber = weeks.slice(0, weekIndex).reduce((count, previousWeek) => count + previousWeek.lessons.length, 0) + 1
          const completeCount = week.lessons.filter((lesson) => completed.includes(lesson.id)).length
          const isOpen = expandedWeeks.has(week.week)
          const milestoneDone = week.milestone && progress.milestones?.[week.milestone.id]?.completed
          return <section className={`week-row ${isOpen ? 'week-open' : ''}`} key={week.week}>
            <button className="week-header" onClick={() => toggle(week.week)} aria-expanded={isOpen}>
              <div className={`week-index ${completeCount === 3 ? 'week-index-done' : ''}`}>{completeCount === 3 ? <Check size={16} /> : String(week.week).padStart(2, '0')}</div>
              <div className="week-title-block"><span>WEEK {String(week.week).padStart(2, '0')}</span><strong>{week.title}</strong><small>{week.canDo}</small></div>
              <div className="week-status"><span>{completeCount}/3</span><ChevronDown size={17} className={isOpen ? 'chevron-rotated' : ''} /></div>
            </button>
            {isOpen && <div className="week-body">
              <div className="week-lessons">{week.lessons.map((lesson, index) => {
                const isDone = completed.includes(lesson.id)
                const started = !!progress.lessonSessions?.[lesson.id]?.startedAt
                return <button className={`lesson-row ${isDone ? 'lesson-row-done' : ''}`} key={lesson.id} onClick={() => onOpenLesson(lesson.id)}>
                  <span className={`lesson-row-icon ${isDone ? 'lesson-row-icon-done' : ''}`}>{isDone ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span><span className="lesson-row-main"><strong>{lesson.title}</strong><small>{lesson.stage.replace('-', ' ')} <span>·</span> {lesson.scene}</small></span><span className={`status-pill ${isDone ? 'status-done' : started ? 'status-started' : ''}`}>{isDone ? 'Practised' : started ? 'In progress' : 'Start'}</span><ArrowRight size={15} className="lesson-row-arrow" />
                </button>
              })}</div>
              <div className="week-support"><div><BookOpen size={15} /><strong>Kana focus</strong></div><div className="week-kana-audio">{week.kanaFocus.filter(isJapanesePracticeText).map((group) => <div className="week-kana-chip" key={group}><span lang="ja">{group}</span><RomajiText text={group} progress={progress} mode={romajiMode} /><SpeechButton text={group} tts={tts} label={`Listen to kana group ${group}`} compact voiceContext={{ weekNumber: week.week, lessonNumber: firstLessonNumber }} /></div>)}</div>{week.kanjiCards.length > 0 && <div className="kanji-focus"><span>Useful kanji</span>{week.kanjiCards.map((item) => <span key={item.kanji} className="kanji-chip"><span lang="ja">{item.kanji}</span> <small lang="ja">{item.reading}</small><RomajiText text={item.reading} progress={progress} mode={romajiMode} /></span>)}</div>}
                {week.milestone && <div className="milestone-mini"><Target size={15} /><span>{week.milestone.title}</span>{milestoneDone ? <span className="milestone-mini-done"><Check size={13} /> saved</span> : <span className="milestone-mini-tag">CHECKPOINT</span>}</div>}
              </div>
            </div>}
          </section>
        })}
      </div>
    </div>
  )
}

function LessonPage({ week, lesson, course, progress, romajiMode, tts, onPatch, onComplete, onRateCard, onBack, onOpenVoiceLab }) {
  const session = progress.lessonSessions?.[lesson.id] || {}
  const lessonNumber = course.weeks.flatMap((item) => item.lessons).findIndex((item) => item.id === lesson.id) + 1
  const voiceContext = { weekNumber: week.week, lessonNumber }
  const [step, setStep] = useState(session.step || 0)
  const [showDialogueText, setShowDialogueText] = useState(false)
  const [showMeaning, setShowMeaning] = useState(false)
  const [showPhrases, setShowPhrases] = useState(false)
  const [listenChoice, setListenChoice] = useState(session.listenChoice ?? null)
  const [responseChoice, setResponseChoice] = useState(session.responseChoice ?? null)
  const [openResponse, setOpenResponse] = useState(session.openResponse || '')
  const [showListenFeedback, setShowListenFeedback] = useState(!!session.listenSubmitted)
  const [showResponseFeedback, setShowResponseFeedback] = useState(!!session.responseSubmitted)
  const [adaptation, setAdaptation] = useState(session.adaptation || '')
  const [warmup, setWarmup] = useState(session.warmup || '')
  const [warmupCue, setWarmupCue] = useState(!!session.warmupCue)
  const [triedAdaptation, setTriedAdaptation] = useState(!!session.triedAdaptation)
  const steps = ['Recall', 'Read the scene', 'Check meaning', 'Choose a reply', 'Make it yours']
  const speechTargets = getLessonSpeechTargets(week, lesson)
  const speakingTargets = [
    ...speechTargets.dialogue.map((line, index) => ({ id: `${lesson.id}-line-${index + 1}`, text: line.ja, meaning: line.en, label: `${labelSpeaker(line.speaker)} · ${line.en}`, detail: lesson.title, type: 'dialogue' })),
    ...speechTargets.phrases.map((phrase, index) => ({ id: `w${week.week}-phrase-${index + 1}`, text: phrase.ja, meaning: phrase.en, label: `Useful phrase · ${phrase.en}`, detail: phrase.use, type: 'phrase' })),
  ]
  const warmupPrompt = getRetrievalPrompt(course, progress, lesson.id)
  const recallCard = warmupPrompt?.phrase
  const priorFunctionWeek = week.milestone ? course.weeks.find((item) => item.week === week.week - 1) || course.weeks[0] : null
  const isComplete = progress.completedLessonIds?.includes(lesson.id)
  const listenCorrect = listenChoice === lesson.listenCheck.answer
  const responseCorrect = lesson.responsePractice.answer == null || responseChoice === lesson.responsePractice.answer
  const isOpenEndedResponse = lesson.responsePractice.answer == null && lesson.responsePractice.choices.length === 0

  useEffect(() => () => tts.stopPlayback(), [lesson.id, tts.stopPlayback])
  useEffect(() => {
    if (step === 1 && tts.activeEngineStatus?.ready) void tts.prewarm?.(voiceContext).catch(() => {})
  }, [step, tts.activeEngineStatus?.ready, tts.prewarm, week.week, lessonNumber])

  function goStep(value) {
    const bounded = Math.max(0, Math.min(steps.length - 1, value))
    if (bounded !== 1) tts.stopPlayback()
    setStep(bounded)
    onPatch({ step: bounded })
  }
  function saveWarmup(value, cue = warmupCue) {
    setWarmup(value)
    setWarmupCue(cue)
    onPatch({ warmup: value, warmupCue: cue })
  }
  function submitCheck(kind) {
    if (kind === 'listen') {
      setShowListenFeedback(true)
      onPatch({ listenChoice, listenSubmitted: true, listenAttempts: (session.listenAttempts || 0) + 1, listenMisses: (session.listenMisses || 0) + (listenCorrect ? 0 : 1) })
    } else {
      setShowResponseFeedback(true)
      const correctText = lesson.responsePractice.choices[lesson.responsePractice.answer]
      const correctPhraseIndex = week.phraseBank.findIndex((phrase) => phrase.ja === correctText)
      const weakCardIds = new Set(session.weakCardIds || [])
      if (!responseCorrect && correctPhraseIndex >= 0) weakCardIds.add(`w${week.week}-phrase-${correctPhraseIndex + 1}`)
      if (responseCorrect && correctPhraseIndex >= 0) weakCardIds.delete(`w${week.week}-phrase-${correctPhraseIndex + 1}`)
      onPatch({ responseChoice, responseSubmitted: true, responseAttempts: (session.responseAttempts || 0) + 1, responseMisses: (session.responseMisses || 0) + (responseCorrect ? 0 : 1), weakCardIds: [...weakCardIds] })
    }
  }
  function updateAdaptation(value) {
    setAdaptation(value)
    onPatch({ adaptation: value })
  }
  function markTried() {
    setTriedAdaptation(true)
    onPatch({ triedAdaptation: true })
  }
  function complete() {
    onComplete()
  }
  function playDialogue(rate = 1) {
    tts.clearError()
    void tts.playDialogue(speechTargets.dialogue, { rate, ...voiceContext }).catch(() => {})
  }

  return <div className="lesson-page page-enter">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Course path</button>
    <div className="lesson-top"><div><div className="eyebrow"><span className="eyebrow-line" /> WEEK {String(week.week).padStart(2, '0')} · {lesson.id}</div><h1>{lesson.title}<span className="title-period">.</span></h1><p>{week.canDo}</p></div><span className={`stage-pill stage-${lesson.stage}`}>{lesson.stage.replace('-', ' ')}</span></div>
    <div className="lesson-layout">
      <aside className="lesson-rail"><div className="rail-title">YOUR PRACTICE</div>{steps.map((label, index) => <button key={label} className={`rail-step ${step === index ? 'rail-step-active' : ''} ${index < step ? 'rail-step-done' : ''}`} onClick={() => goStep(index)}><span>{index < step ? <Check size={14} /> : String(index + 1)}</span>{label}{step === index && <ChevronRight size={14} />}</button>)}<div className="rail-tip"><Lightbulb size={15} /><span>Try first. Reveal a cue whenever you need one.</span></div></aside>
      <div className="lesson-main">
        {step === 0 && <section className="practice-card">
          <StepLabel number="01" label="QUICK RECALL" /><h2>What can you remember?</h2><p className="practice-intro">Before you see today’s phrases, take a moment to recall one useful expression from your last lesson. This is practice, not a test.</p>
          <div className="recall-prompt"><div className="recall-icon"><RotateCcw size={17} /></div><div><span>{warmupPrompt?.label || 'Quick recall'}</span><strong>{recallCard?.use || warmupPrompt?.prompt}</strong></div></div>
          {warmupPrompt?.context && <p className="recall-context">{warmupPrompt.context}</p>}
          {warmupCue && <div className="cue-reveal"><span>Small cue</span><strong lang="ja">{recallCard?.ja || 'こんにちは。'}</strong><SpeechButton text={recallCard?.ja || 'こんにちは。'} tts={tts} label="Listen to the recall cue" compact voiceContext={voiceContext} /><small>{recallCard?.en || 'Hello / good afternoon.'}</small></div>}
          <div className="recall-actions"><button className={`choice-pill ${warmup === 'remembered' ? 'choice-pill-selected' : ''}`} onClick={() => saveWarmup('remembered')}>I recalled something</button><button className={`choice-pill ${warmup === 'cue' ? 'choice-pill-selected' : ''}`} onClick={() => { saveWarmup('cue', true); setWarmupCue(true) }}>Show me a cue</button><button className={`choice-pill ${warmup === 'skipped' ? 'choice-pill-selected' : ''}`} onClick={() => saveWarmup('skipped')}>Skip for now</button></div>
          <div className="practice-footer"><span className="muted-caption">Your response is private and unscored.</span><button className="primary-button" onClick={() => goStep(1)}>Continue to the scene <ArrowRight size={15} /></button></div>
        </section>}
        {step === 1 && <section className="practice-card">
          <StepLabel number="02" label="SCENE & DIALOGUE" /><h2>Picture the moment.</h2><div className="scene-banner"><Compass size={18} /><span>{lesson.scene}</span></div>
          <div className="listen-first-panel"><div className="listen-first-copy"><strong>Listen first</strong><span>One selected local voice reads each turn with a short pause. Kana and English stay hidden until you reveal them.</span><small>{tts.activeEngineStatus?.modelName || 'Selected local voice'} · audio is generated on this device</small></div><div className="listen-first-actions">
            <button type="button" className="primary-button" onClick={() => playDialogue(1)} disabled={!tts.activeEngineStatus?.ready || tts.busy} aria-label="Listen to the whole dialogue at normal speed"><Volume2 size={15} /> Listen · normal speed</button>
            <button type="button" className="outline-button" onClick={() => playDialogue(0.85)} disabled={!tts.activeEngineStatus?.ready || tts.busy} aria-label="Replay the whole dialogue at 0.85 times speed">Replay slowly · 0.85×</button>
            {(tts.isPlaying || tts.busy) && <button type="button" className="outline-button" onClick={tts.stopPlayback}><X size={14} /> Stop</button>}
          </div><div className="listen-playback-status" role="status">{tts.isPlaying ? 'Playing the conversation…' : tts.busy ? 'Preparing local speech…' : 'Natural-speed audio stays available; slow replay is optional.'}</div></div>
          <SpeechSetupNote tts={tts} onOpenVoiceLab={onOpenVoiceLab} />
          <div className="text-first-notice"><span className="notice-dot" /> Listen, then reveal <span>You can show kana at any time; English meanings are optional.</span></div>
          <div className="dialogue-list">{speechTargets.dialogue.map((line, index) => <div className={`dialogue-line ${line.speaker.toLowerCase().includes('traveller') || line.speaker === 'visitor' ? 'dialogue-own' : ''}`} key={`${index}-${line.ja}`}><div className="speaker-label">{labelSpeaker(line.speaker)}</div><div className="dialogue-bubble"><strong lang="ja">{showDialogueText ? line.ja : <span className="dialogue-hidden-text">Japanese hidden · listen to this turn</span>}</strong>{showDialogueText && <RomajiText text={line.ja} progress={progress} mode={romajiMode} />}{showMeaning && showDialogueText && <span className="dialogue-meaning">{line.en}</span>}<SpeechButton text={line.ja} tts={tts} label={`Play ${labelSpeaker(line.speaker)} line in Japanese`} compact className="dialogue-play-button" voiceContext={voiceContext} /></div></div>)}</div>
          <div className="lesson-tools"><button type="button" className={`outline-button ${showDialogueText ? 'tool-on' : ''}`} onClick={() => { setShowDialogueText((visible) => !visible); if (showDialogueText) setShowMeaning(false) }}>{showDialogueText ? <X size={15} /> : <BookOpen size={15} />}{showDialogueText ? 'Hide kana' : 'Reveal kana'}</button>{showDialogueText && <button type="button" className={`outline-button ${showMeaning ? 'tool-on' : ''}`} onClick={() => setShowMeaning(!showMeaning)}>{showMeaning ? <X size={15} /> : <BookOpen size={15} />}{showMeaning ? 'Hide meanings' : 'Reveal English meanings'}</button>}<button type="button" className={`outline-button ${showPhrases ? 'tool-on' : ''}`} onClick={() => setShowPhrases(!showPhrases)}>{showPhrases ? <X size={15} /> : <Lightbulb size={15} />}{showPhrases ? 'Hide phrase bank' : 'Open phrase bank'}</button></div>
          {showPhrases && <div className="phrase-bank-inline">{speechTargets.phrases.map((item, index) => <div className="phrase-bank-item" key={`${item.ja}-${index}`}><div className="phrase-bank-line"><div><strong lang="ja">{item.ja}</strong><RomajiText text={item.ja} progress={progress} mode={romajiMode} /></div><SpeechButton text={item.ja} tts={tts} label={`Listen to phrase ${item.ja}`} compact voiceContext={voiceContext} /></div><span>{item.en}</span><small>{item.use}</small></div>)}</div>}
          <div className="practice-footer"><span className="muted-caption">Audio is optional; reveal kana whenever you want.</span><button className="primary-button" onClick={() => goStep(2)}>Check what you understood <ArrowRight size={15} /></button></div>
        </section>}
        {step === 2 && <QuestionCard number="03" label="GIST & KEY DETAIL" title="Check what you understood." prompt={lesson.listenCheck.question} choices={lesson.listenCheck.choices} value={listenChoice} setValue={(value) => { setListenChoice(value); setShowListenFeedback(false); onPatch({ listenChoice: value, listenSubmitted: false }) }} submitted={showListenFeedback} correct={listenCorrect} answer={lesson.listenCheck.answer} feedback={listenCorrect ? 'That matches the key detail in the scene.' : `Try again. Look for the detail that answers the question.`} onSubmit={() => submitCheck('listen')} onNext={() => goStep(3)} voiceContext={voiceContext} />}
        {step === 3 && isOpenEndedResponse && <OpenResponseCard prompt={lesson.responsePractice.prompt} guidance={lesson.responsePractice.why} phraseBank={speechTargets.phrases} tts={tts} voiceContext={voiceContext} value={openResponse} submitted={showResponseFeedback} setValue={(value) => { setOpenResponse(value); setShowResponseFeedback(false); onPatch({ openResponse: value, responseSubmitted: false }) }} onSubmit={() => { setShowResponseFeedback(true); onPatch({ openResponse, responseSubmitted: true }) }} onNext={() => goStep(4)} />}
        {step === 3 && !isOpenEndedResponse && <QuestionCard number="04" label="RESPOND WITH SUPPORT" title="Choose a natural reply." prompt={lesson.responsePractice.prompt} choices={lesson.responsePractice.choices} value={responseChoice} setValue={(value) => { setResponseChoice(value); setShowResponseFeedback(false); onPatch({ responseChoice: value, responseSubmitted: false }) }} submitted={showResponseFeedback} correct={responseCorrect} answer={lesson.responsePractice.answer} feedback={responseCorrect ? lesson.responsePractice.why : 'Not quite in this situation. Try another option, then read why the best fit works.'} onSubmit={() => submitCheck('response')} onNext={() => goStep(4)} why={lesson.responsePractice.why} tts={tts} voiceContext={voiceContext} />}
        {step === 4 && <section className="practice-card">
          <StepLabel number="05" label="ADAPT & WRAP UP" /><h2>Make the exchange yours.</h2><p className="practice-intro">Change one detail or add a follow-up. Try it aloud, with a partner, or as a short written response — no recording or automated scoring.</p>
          <div className="adapt-prompt"><span className="adapt-prompt-icon"><Sparkles size={17} /></span><div><span>YOUR ADAPTATION</span><strong>{lesson.adaptation}</strong></div></div>
          <div className="say-task"><div className="say-task-head"><ListChecks size={16} /><strong>Try the conversation</strong><span>Partner, tutor, or self-led</span></div><p>{lesson.sayTask}</p><button className={`outline-button ${triedAdaptation ? 'tool-on' : ''}`} onClick={markTried}>{triedAdaptation ? <Check size={15} /> : <CircleCheck size={15} />}{triedAdaptation ? 'Attempt noted' : 'I tried the task'}</button></div>
          <LessonSpeakingPractice targets={speakingTargets} tts={tts} voiceContext={voiceContext} progress={progress} romajiMode={romajiMode} onRate={onRateCard} onOpenVoiceLab={onOpenVoiceLab} />
          <label className="field-label" htmlFor="adaptation-note">What did you change? <span>optional reflection</span></label><textarea id="adaptation-note" className="reflection-input" rows="3" placeholder="A new place, item, time, or follow-up…" value={adaptation} onChange={(event) => updateAdaptation(event.target.value)} />
          {priorFunctionWeek && <div className="checkpoint-revisit"><div className="checkpoint-revisit-icon"><Target size={15} /></div><div><span>Checkpoint revisit · Week {String(priorFunctionWeek.week).padStart(2, '0')}</span><strong>Mix in this earlier function: {priorFunctionWeek.canDo}</strong></div></div>}
          <div className="context-learning"><div className="context-head"><BookOpen size={16} /><strong>Notice the writing</strong></div><div className="kana-groups">{speechTargets.kanaFocus.map((group) => <span className="kana-audio-chip" key={group}><span lang="ja">{group}</span><SpeechButton text={group} tts={tts} label={`Listen to kana group ${group}`} compact voiceContext={voiceContext} /></span>)}</div>{speechTargets.kanjiReadings.length > 0 && <div className="kanji-card-row">{speechTargets.kanjiReadings.map((item) => <div className="mini-kanji-card" key={item.kanji}><strong lang="ja">{item.kanji}</strong><span lang="ja">{item.reading} · {item.meaning}</span><SpeechButton text={item.reading} tts={tts} label={`Listen to the reading ${item.reading}`} compact voiceContext={voiceContext} /><RomajiText text={item.reading} progress={progress} mode={romajiMode} /><small>{item.whyHere}</small></div>)}</div>}</div>
          <div className="success-checks"><span className="eyebrow">WHAT THIS PRACTICE INVITED YOU TO TRY</span>{lesson.successChecks.map((item, index) => <div key={`${index}-${item}`}><CircleCheck size={14} /><span>{item}</span></div>)}</div>
          <div className="practice-footer complete-footer"><span className="muted-caption">Self-recorded after practice — not a proficiency score.</span><button className="primary-button" onClick={complete}>{isComplete ? 'Back to today' : 'Mark my practice complete'} <Check size={15} /></button></div>
        </section>}
        <div className="lesson-bottom-nav"><button className="text-link" onClick={() => goStep(step - 1)} disabled={step === 0}><ArrowLeft size={14} /> Previous step</button><span>{step + 1} of {steps.length}</span>{step < steps.length - 1 && <button className="text-link" onClick={() => goStep(step + 1)}>Next step <ArrowRight size={14} /></button>}</div>
      </div>
    </div>
  </div>
}

function StepLabel({ number, label }) {
  return <div className="step-label"><span>{number}</span>{label}</div>
}

function OpenResponseCard({ prompt, guidance, phraseBank, tts, voiceContext, value, submitted, setValue, onSubmit, onNext }) {
  return <section className="practice-card question-card">
    <StepLabel number="04" label="OPEN-ENDED RESPONSE" /><h2>Make a flexible reply.</h2><p className="question-prompt">{prompt}</p>
    <label className="field-label" htmlFor="open-response">Try your reply in Japanese <span>not scored</span></label>
    <textarea id="open-response" lang="ja" className="reflection-input open-response-input" rows="4" placeholder="Write a phrase or a few lines you would try…" value={value} onChange={(event) => setValue(event.target.value)} />
    {submitted && <div className="open-response-guidance" role="status"><strong>No single answer key</strong><p>{guidance}</p></div>}
    {submitted && phraseBank?.length > 0 && <div className="phrase-bank-inline">{phraseBank.map((item, index) => <div className="phrase-bank-item" key={`${item.ja}-${index}`}><div className="phrase-bank-line"><strong lang="ja">{item.ja}</strong><SpeechButton text={item.ja} tts={tts} label={`Listen to phrase ${item.ja}`} compact voiceContext={voiceContext} /></div><span>{item.en}</span><small>{item.use}</small></div>)}</div>}
    <div className="practice-footer"><span className="muted-caption">Try first; then compare with the guidance and phrase bank.</span>{submitted ? <button className="primary-button" onClick={onNext}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" onClick={onSubmit} disabled={!value.trim()}>Compare my reply <ArrowRight size={15} /></button>}</div>
  </section>
}

function QuestionCard({ number, label, title, prompt, choices, value, setValue, submitted, correct, answer, feedback, onSubmit, onNext, why, tts, voiceContext }) {
  const hasAnswer = value !== null && value !== undefined
  return <section className="practice-card question-card"><StepLabel number={number} label={label} /><h2>{title}</h2><p className="question-prompt">{prompt}</p><div className="answer-options">{choices.map((choice, index) => <div className="answer-option-row" key={`${index}-${choice}`}><button className={`answer-option ${value === index ? 'answer-option-selected' : ''} ${submitted && value === index && correct ? 'answer-option-correct' : ''} ${submitted && value === index && !correct ? 'answer-option-wrong' : ''}`} onClick={() => setValue(index)}><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span lang="ja">{choice}</span>{submitted && value === index && correct && <Check size={16} />}</button>{tts && isJapanesePracticeText(choice) && <SpeechButton text={choice} tts={tts} label={`Listen to reply ${choice}`} compact className="answer-option-speech" voiceContext={voiceContext} />}</div>)}</div>
    {submitted && <div className={`feedback-box ${correct ? 'feedback-good' : 'feedback-retry'}`}><span>{correct ? <Check size={16} /> : <RotateCcw size={16} />}</span><div><strong>{correct ? 'Good catch' : 'Keep exploring'}</strong><p>{feedback}{why && correct ? ` ${why}` : ''}</p></div></div>}
    <div className="practice-footer"><span className="muted-caption">A task-level check — not a proficiency score.</span>{submitted && correct ? <button className="primary-button" onClick={onNext}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" onClick={submitted && !correct ? () => { setValue(null) } : onSubmit} disabled={!hasAnswer}>{submitted && !correct ? 'Try another answer' : 'Check my answer'} <ArrowRight size={15} /></button>}</div>
  </section>
}

function ReviewPage({ cards, progress, romajiMode, onRate, onPhrasebook, tts, onOpenVoiceLab }) {
  const [queueIds] = useState(() => new Set(cards.map((card) => card.id)))
  const [reviewedIds, setReviewedIds] = useState(() => new Set())
  const [flipped, setFlipped] = useState(false)
  const [direction, setDirection] = useState('recognize')
  const current = cards.find((card) => queueIds.has(card.id) && !reviewedIds.has(card.id))
  const queueSize = queueIds.size
  const reviewedCount = reviewedIds.size
  const useProductionPrompt = direction === 'produce' && ['phrase', 'dialogue'].includes(current?.type)
  const ratingIntervals = current ? getRatingIntervals(progress, current.id, todayISO()) : {}
  function rate(rating) {
    if (!current) return
    onRate(current, rating)
    setFlipped(false)
    setReviewedIds((known) => new Set([...known, current.id]))
  }
  const remaining = Math.max(0, queueSize - reviewedCount)
  return <div className="content-page review-page page-enter">
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> SHORT, SPACED PRACTICE</div><h1>Review cards<span className="title-period">.</span></h1><p>Try to recall first, flip for the meaning, then choose how easily it came back.</p></div>
    <div className="review-summary"><div className="summary-icon"><RotateCcw size={19} /></div><div><strong>{queueSize ? `${queueSize} cards in today’s short session` : 'All caught up for today'}</strong><span>Cards come from your unlocked course phrases, kana focus, and practical kanji.</span></div><span className="review-progress-text">{queueSize ? `${reviewedCount} / ${queueSize} reviewed` : 'Queue complete'}</span></div>
    <div className="review-direction" role="group" aria-label="Choose recall direction"><span>Practice direction</span><button type="button" className={direction === 'recognize' ? 'is-selected' : ''} aria-pressed={direction === 'recognize'} onClick={() => setDirection('recognize')}>Japanese → meaning</button><button type="button" className={direction === 'produce' ? 'is-selected' : ''} aria-pressed={direction === 'produce'} onClick={() => setDirection('produce')}>Meaning → Japanese</button><small>Reverse recall applies to phrase and dialogue cards; kana and kanji stay recognition-first.</small></div>
    <SpeechSetupNote tts={tts} onOpenVoiceLab={onOpenVoiceLab} />
    {!current ? <div className="empty-review panel"><div className="empty-icon"><Sparkles size={21} /></div><h2>Nice work. You’re done for now.</h2><p>{queueSize ? 'You have finished today’s selected cards. More come back as they become due.' : 'Start a lesson to add useful phrases to your spaced-retrieval deck.'}</p><button className="primary-button" onClick={onPhrasebook}>Browse phrasebook <ArrowRight size={15} /></button></div> : <div className="flashcard-wrap">
      <div className="flashcard-meta"><span className={`type-pill type-${current.type}`}>{current.type}</span><span>Week {String(current.week).padStart(2, '0')}</span><span className="flashcard-index">CARD {String(reviewedCount + 1).padStart(2, '0')}</span></div>
      {(!useProductionPrompt || flipped) && <div className="flashcard-listen"><SpeechButton text={current.front} tts={tts} label={useProductionPrompt ? 'Listen to the Japanese answer' : `Listen to ${current.type} review prompt`} />{tts.isPlaying && <span role="status">Playing prompt…</span>}</div>}
      <button className={`flashcard ${flipped ? 'flashcard-flipped' : ''}`} onClick={() => setFlipped((value) => !value)} aria-label={flipped ? 'Show card front' : 'Reveal answer'}>
          <span className="flashcard-corner">{flipped ? 'ANSWER' : 'RECALL'}</span>{flipped ? <><span className="flashcard-main" lang={useProductionPrompt ? 'ja' : undefined}>{useProductionPrompt ? current.front : current.back}</span>{current.type === 'kanji' ? <RomajiText text={current.reading} progress={progress} mode={romajiMode} /> : (useProductionPrompt || current.type !== 'kanji') && <RomajiText text={current.front} progress={progress} mode={romajiMode} />}{current.detail && <span className="flashcard-detail">{current.detail}</span>}</> : <><span className="flashcard-main" lang={useProductionPrompt ? undefined : 'ja'}>{useProductionPrompt ? current.back : current.front}</span>{!useProductionPrompt && <RomajiText text={current.front} progress={progress} mode={romajiMode} />}<span className="flashcard-hint">{useProductionPrompt ? 'Recall the Japanese line, then tap to reveal.' : 'Think of the meaning, then tap to reveal.'}</span></>}
        <span className="flashcard-flip">{flipped ? 'Tap to see prompt' : 'Tap to reveal'} <RotateCcw size={13} /></span>
      </button>
      {flipped ? <div className="rating-row"><span>How easy was that?</span><div>{[['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([rating, label]) => <button key={rating} className={`rating-button rating-${rating}`} onClick={() => rate(rating)}>{label}<small>{ratingIntervals[rating]} day{ratingIntervals[rating] === 1 ? '' : 's'}</small></button>)}</div></div> : <div className="flip-instruction"><RotateCcw size={14} /> Reveal the {useProductionPrompt ? 'Japanese line' : 'meaning'} when you’ve had a try</div>}
      <div className="review-footer"><span>Up to 8 cards · difficult items return sooner</span><button className="text-link" onClick={onPhrasebook}>Open phrasebook <ArrowRight size={14} /></button></div>
    </div>}
    <div className="review-footnote"><Lightbulb size={15} /><span>Missed a phrase? It returns sooner. Recalled it easily? It will wait longer before the next review.</span></div>
  </div>
}

function PhrasebookPage({ cards, search, setSearch, progress, romajiMode, tts, onOpenVoiceLab }) {
  const [filter, setFilter] = useState('all')
  const [revealed, setRevealed] = useState(new Set())
  const filtered = cards.filter((card) => {
    const matchesType = filter === 'all' || card.type === filter
    const query = search.trim().toLowerCase()
    return matchesType && (!query || `${card.front} ${card.back} ${card.detail} ${card.week}`.toLowerCase().includes(query))
  })
  function toggle(id) {
    setRevealed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  return <div className="content-page page-enter">
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> COURSE LANGUAGE, ALL IN ONE PLACE</div><h1>Phrasebook<span className="title-period">.</span></h1><p>Useful expressions and script support, organised from the lessons you’re learning.</p></div>
    <SpeechSetupNote tts={tts} onOpenVoiceLab={onOpenVoiceLab} />
    <div className="phrase-tools"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Japanese, meaning, or use…" /></label><div className="filter-tabs">{[['all', 'All'], ['phrase', 'Phrases'], ['dialogue', 'Speech lines'], ['kana', 'Kana'], ['kanji', 'Kanji']].map(([key, label]) => <button key={key} className={filter === key ? 'filter-active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    <div className="phrase-count">{filtered.length} {filter === 'all' ? 'learning cards' : `${filter} cards`}</div>
    <div className="phrase-grid">{filtered.map((card) => {
      const isOpen = revealed.has(card.id)
      return <article className={`phrase-card phrase-${card.type}`} key={card.id}><div className="phrase-card-top"><span className={`type-pill type-${card.type}`}>{card.type}</span><span>W{String(card.week).padStart(2, '0')}</span><SpeechButton text={card.front} tts={tts} label={`Listen to ${card.type} card ${card.front}`} compact /></div><strong className="phrase-front" lang="ja">{card.front}</strong><RomajiText text={card.type === 'kanji' ? card.reading : card.front} progress={progress} mode={romajiMode} /><div className={`phrase-back ${isOpen ? 'phrase-back-open' : ''}`}><span>{card.back}</span>{card.detail && <small>{card.detail}</small>}</div><button type="button" className="phrase-card-foot" onClick={() => toggle(card.id)} aria-expanded={isOpen}>{isOpen ? 'Hide meaning' : 'Reveal meaning'} <ChevronDown size={14} /></button></article>
    })}</div>
    {filtered.length === 0 && <div className="empty-results"><Search size={19} /><strong>No matching cards</strong><span>Try another word or choose a different category.</span></div>}
  </div>
}

function MilestonesPage({ weeks, progress, onSave }) {
  const milestones = weeks.filter((week) => week.milestone)
  return <div className="content-page page-enter">
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> CHECKPOINTS, NOT EXAMS</div><h1>Milestones<span className="title-period">.</span></h1><p>Record what you tried, what support helped, and what you want to practise next. These checkpoints are learner evidence, not a fluency rating.</p></div>
    <div className="milestone-list">{milestones.map((week) => {
      const item = week.milestone
      const saved = progress.milestones?.[item.id] || {}
      const evidence = saved.evidenceNotes || {}
      return <section className={`milestone-card ${saved.completed ? 'milestone-complete' : ''}`} key={item.id}>
        <div className="milestone-card-head"><div className={`milestone-week-icon ${saved.completed ? 'milestone-week-done' : ''}`}>{saved.completed ? <Check size={17} /> : String(week.week).padStart(2, '0')}</div><div className="milestone-heading"><span>END OF WEEK {String(week.week).padStart(2, '0')}</span><h2>{item.title}</h2></div><span className={`milestone-state ${saved.completed ? 'milestone-state-done' : ''}`}>{saved.completed ? 'Evidence saved' : 'Ready when you are'}</span></div>
        <p className="milestone-task">{item.task}</p><div className="evidence-fields"><span className="eyebrow">EVIDENCE TO RECORD</span>{item.evidence.map((prompt, index) => <label className="evidence-field" key={`${item.id}-${index}`}><span>{prompt}</span><textarea rows="2" value={evidence[index] || ''} placeholder="Add a short note about what you tried…" onChange={(event) => onSave(item.id, { evidenceNotes: { ...evidence, [index]: event.target.value }, completed: false })} /></label>)}</div>
        <label className="field-label" htmlFor={`reflection-${item.id}`}>Next practice target <span>reflection</span></label><textarea className="reflection-input" id={`reflection-${item.id}`} rows="2" value={saved.nextTarget || ''} placeholder="What would you like to try again?" onChange={(event) => onSave(item.id, { nextTarget: event.target.value, completed: false })} />
        <div className="milestone-actions"><span className="muted-caption">Your notes remain on this device.</span><button className={`outline-button ${saved.completed ? 'tool-on' : ''}`} onClick={() => onSave(item.id, { completed: !saved.completed, savedAt: !saved.completed ? new Date().toISOString() : null })}>{saved.completed ? <Check size={15} /> : <CircleCheck size={15} />}{saved.completed ? 'Checkpoint recorded' : 'Record this checkpoint'}</button></div>
      </section>
    })}</div>
    <div className="milestone-note"><Lightbulb size={16} /><span>Checkpoint tasks and thresholds are preserved from the course draft. They’re intended to be tuned in a learner pilot.</span></div>
  </div>
}

function SettingsPage({ theme, textScale, romajiMode, onThemeChange, onTextScaleChange, onRomajiModeChange, onExport }) {
  const themeOptions = [
    { value: 'light', label: 'Light', detail: 'Soft paper and green glass.', icon: <Sun size={19} /> },
    { value: 'dark', label: 'Dark', detail: 'A calm, low-light palette.', icon: <Moon size={19} /> },
    { value: 'amoled', label: 'AMOLED', detail: 'Deep black surfaces for OLED screens.', icon: <CircleCheck size={19} /> }
  ]
  const sizeOptions = [
    { value: 1, label: 'Standard', detail: '100% · compact' },
    { value: 1.18, label: 'Comfortable', detail: '118% · recommended' },
    { value: 1.32, label: 'Large', detail: '132% · extra readable' }
  ]
  const romajiOptions = [
    { value: 'adaptive', label: 'Fade out as kana sticks', detail: 'Shown until the kana cards are recalled comfortably on two different days.' },
    { value: 'always', label: 'Always show romaji', detail: 'Keep the pronunciation scaffold visible under kana.' },
    { value: 'hidden', label: 'Hide romaji', detail: 'Use Japanese script without a romanized cue.' }
  ]

  return <div className="content-page settings-page page-enter">
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> MAKE KANAFISH YOURS</div><h1>Settings<span className="title-period">.</span></h1><p>Choose a comfortable appearance and reading size. Your preferences stay on this device.</p></div>
    <section className="settings-section" aria-labelledby="appearance-heading">
      <div className="settings-section-heading"><div className="settings-section-icon"><Moon size={18} /></div><div><h2 id="appearance-heading">Appearance</h2><p>Pick the surface that feels right for your screen.</p></div></div>
      <div className="settings-choice-grid" role="group" aria-labelledby="appearance-heading">
        {themeOptions.map((option) => <button type="button" aria-pressed={theme === option.value} className={`settings-choice ${theme === option.value ? 'is-selected' : ''}`} key={option.value} onClick={() => onThemeChange(option.value)}>
          <span className="settings-choice-icon">{option.icon}</span><span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.detail}</small></span><span className="settings-radio-mark" aria-hidden="true" />
        </button>)}
      </div>
    </section>
    <section className="settings-section" aria-labelledby="readability-heading">
      <div className="settings-section-heading"><div className="settings-section-icon"><Type size={18} /></div><div><h2 id="readability-heading">Text size</h2><p>Course explanations, labels, and controls scale together.</p></div></div>
      <div className="settings-choice-grid settings-size-grid" role="group" aria-labelledby="readability-heading">
        {sizeOptions.map((option) => <button type="button" aria-pressed={textScale === option.value} className={`settings-choice settings-size-choice ${textScale === option.value ? 'is-selected' : ''}`} key={option.value} onClick={() => onTextScaleChange(option.value)}>
          <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.detail}</small></span><span className="settings-radio-mark" aria-hidden="true" />
        </button>)}
      </div>
    </section>
    <section className="settings-section" aria-labelledby="romaji-heading">
      <div className="settings-section-heading"><div className="settings-section-icon"><BookOpen size={18} /></div><div><h2 id="romaji-heading">Romaji scaffold</h2><p>Kana stays primary; romanization is a temporary support, not a course requirement.</p></div></div>
      <div className="settings-choice-grid" role="group" aria-labelledby="romaji-heading">
        {romajiOptions.map((option) => <button type="button" aria-pressed={romajiMode === option.value} className={`settings-choice ${romajiMode === option.value ? 'is-selected' : ''}`} key={option.value} onClick={() => onRomajiModeChange(option.value)}>
          <span className="settings-choice-copy"><strong>{option.label}</strong><small>{option.detail}</small></span><span className="settings-radio-mark" aria-hidden="true" />
        </button>)}
      </div>
    </section>
    <section className="settings-section" aria-labelledby="data-heading">
      <div className="settings-section-heading"><div className="settings-section-icon"><LockKeyhole size={18} /></div><div><h2 id="data-heading">Your data</h2><p>Settings and learning progress stay on this device. Export a copy any time.</p></div></div>
      <button type="button" className="settings-export-button" onClick={onExport}><Download size={15} /><span>Export progress</span></button>
    </section>
  </div>
}

export default App
