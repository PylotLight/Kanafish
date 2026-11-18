import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleCheck, Clock3, Compass, Download, Flame, GraduationCap, Lightbulb, ListChecks,
  LockKeyhole, LogOut, Moon, PanelLeftClose, PanelLeftOpen, RotateCcw, Search, Settings,
  Sparkles, Sun, Target, Type, Volume2, X
} from 'lucide-react'
import { loadPreferences, savePreferences } from '../preferences.js'
import course from '../../../course/course-v1.json'
import {
  createInitialProgress, getCourseStats, getDueCards, getFlashcards, getLessons,
  getRetrievalPrompt, markLessonComplete, normalizeProgress, rateCard, saveLessonSession, saveMilestone
} from '../learning.js'
import { useTts } from './tts/useTts.js'
import VoiceLabPage from './tts/VoiceLabPage.jsx'

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
  const tts = useTts()
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
    const blob = new Blob([JSON.stringify({ app: 'Kanafish', version: 1, exportedAt: new Date().toISOString(), progress: progressRef.current }, null, 2)], { type: 'application/json' })
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
    <div className="app-shell" data-theme={preferences.theme} style={{ '--text-scale': preferences.textScale }}>
      <aside className={`sidebar ${preferences.sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>か</span><span>な</span></div>
          <div><strong>Kanafish</strong><small>Japanese, for real life</small></div>
        </div>
        <div className="course-chip"><span className="course-chip-dot" /> BEGINNER COURSE <span>12 WEEKS</span></div>
        <nav id="primary-nav" className="primary-nav" aria-label="Main navigation">
          <NavButton icon={<CalendarDays size={18} />} label="Today" active={view === 'today'} onClick={() => navigate('today')} />
          <NavButton icon={<Compass size={18} />} label="Course path" active={view === 'course'} onClick={() => navigate('course')} />
          <NavButton icon={<RotateCcw size={18} />} label="Review cards" active={view === 'review'} onClick={() => navigate('review')} badge={dueCards.length || null} />
          <NavButton icon={<BookOpen size={18} />} label="Phrasebook" active={view === 'phrasebook'} onClick={() => navigate('phrasebook')} />
          <NavButton icon={<Volume2 size={18} />} label="Voice Lab" active={view === 'voice-lab'} onClick={() => navigate('voice-lab')} />
          <NavButton icon={<Target size={18} />} label="Milestones" active={view === 'milestones'} onClick={() => navigate('milestones')} />
        </nav>
        <div className="sidebar-progress">
          <div className="sidebar-progress-top"><span>Course progress</span><strong>{stats.percent}%</strong></div>
          <ProgressBar value={stats.percent} />
          <small>{stats.completedLessons} of {stats.totalLessons} lessons</small>
        </div>
        <div className="sidebar-bottom">
          <div className="local-note"><LockKeyhole size={15} /><span>Your progress stays on this device.</span></div>
          <button type="button" className="quiet-button export-button" onClick={exportProgress} aria-label="Export progress" title="Export progress"><Download size={15} /><span>Export progress</span></button>
          <div className="sidebar-utility" role="group" aria-label="App actions">
            <button type="button" className="sidebar-dock-button" onClick={() => updatePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })} aria-label={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!preferences.sidebarCollapsed} aria-controls="primary-nav" title={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {preferences.sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span className="sr-only">{preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </button>
            <button type="button" className={`sidebar-dock-button ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} title="Settings"><Settings size={17} /><span className="sr-only">Settings</span></button>
            <button type="button" className="sidebar-dock-button exit-button" onClick={() => window.kanafish?.exitApp?.()} aria-label="Exit Kanafish" title="Exit Kanafish"><LogOut size={17} /><span className="sr-only">Exit Kanafish</span></button>
          </div>
          <div className="profile-row"><div className="avatar">L</div><div><strong>Learner</strong><small>Self-paced practice</small></div><Sparkles className="profile-sparkle" size={16} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Japanese travel course</span><ChevronRight size={14} /><strong>{viewTitle(view, selected?.lesson)}</strong></div>
          <div className="topbar-right"><span className="offline-pill"><span /> Text-first practice</span><span className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span></div>
        </header>
        {persistenceError && <div className="save-warning" role="alert"><span>{persistenceError}</span><button onClick={exportProgress}><Download size={14} /> Export progress</button></div>}
        <div className="page-content">
          {view === 'today' && <TodayPage course={course} stats={stats} dueCount={dueCards.length} onOpenLesson={openLesson} onReview={() => navigate('review')} onCourse={() => navigate('course')} progress={progress} />}
          {view === 'course' && <CoursePage weeks={course.weeks} progress={progress} expandedWeeks={expandedWeeks} setExpandedWeeks={setExpandedWeeks} onOpenLesson={openLesson} />}
          {view === 'lesson' && selected && selectedWeek && <LessonPage key={selected.lesson.id} week={selectedWeek} lesson={selected.lesson} course={course} progress={progress} tts={tts} onPatch={patchLesson} onComplete={() => {
            updateProgress((state) => markLessonComplete(state, selected.lesson.id, todayISO()))
            setView('today')
            setSelectedLessonId(null)
          }} onBack={() => navigate('course')} />}
          {view === 'review' && <ReviewPage cards={dueCards} onRate={(cardId, rating) => updateProgress((state) => rateCard(state, cardId, rating, todayISO()))} onPhrasebook={() => navigate('phrasebook')} />}
          {view === 'phrasebook' && <PhrasebookPage cards={cards} search={search} setSearch={setSearch} />}
          {view === 'voice-lab' && <VoiceLabPage tts={tts} />}
          {view === 'milestones' && <MilestonesPage weeks={course.weeks} progress={progress} onSave={(id, patch) => updateProgress((state) => saveMilestone(state, id, patch))} />}
          {view === 'settings' && <SettingsPage theme={preferences.theme} textScale={preferences.textScale} onThemeChange={(theme) => updatePreferences({ theme })} onTextScaleChange={(textScale) => updatePreferences({ textScale })} />}
        </div>
      </main>
    </div>
  )
}

function NavButton({ icon, label, active, onClick, badge }) {
  return <button type="button" className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined} title={label}>{icon}<span>{label}</span>{badge ? <em>{badge}</em> : null}</button>
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

function CoursePage({ weeks, progress, expandedWeeks, setExpandedWeeks, onOpenLesson }) {
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
      <div className="week-list">
        {weeks.map((week) => {
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
              <div className="week-support"><div><BookOpen size={15} /><strong>Kana focus</strong></div><p>{week.kanaFocus.join('　')}</p>{week.kanjiCards.length > 0 && <div className="kanji-focus"><span>Useful kanji</span>{week.kanjiCards.map((item) => <span key={item.kanji} className="kanji-chip">{item.kanji} <small>{item.reading}</small></span>)}</div>}
                {week.milestone && <div className="milestone-mini"><Target size={15} /><span>{week.milestone.title}</span>{milestoneDone ? <span className="milestone-mini-done"><Check size={13} /> saved</span> : <span className="milestone-mini-tag">CHECKPOINT</span>}</div>}
              </div>
            </div>}
          </section>
        })}
      </div>
    </div>
  )
}

function LessonPage({ week, lesson, course, progress, tts, onPatch, onComplete, onBack }) {
  const session = progress.lessonSessions?.[lesson.id] || {}
  const [step, setStep] = useState(session.step || 0)
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
  const warmupPrompt = getRetrievalPrompt(course, progress, lesson.id)
  const recallCard = warmupPrompt?.phrase
  const priorFunctionWeek = week.milestone ? course.weeks.find((item) => item.week === week.week - 1) || course.weeks[0] : null
  const isComplete = progress.completedLessonIds?.includes(lesson.id)
  const listenCorrect = listenChoice === lesson.listenCheck.answer
  const responseCorrect = lesson.responsePractice.answer == null || responseChoice === lesson.responsePractice.answer
  const isOpenEndedResponse = lesson.responsePractice.answer == null && lesson.responsePractice.choices.length === 0

  function goStep(value) {
    const bounded = Math.max(0, Math.min(steps.length - 1, value))
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
      onPatch({ listenChoice, listenSubmitted: true })
    } else {
      setShowResponseFeedback(true)
      onPatch({ responseChoice, responseSubmitted: true })
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
          {warmupCue && <div className="cue-reveal"><span>Small cue</span><strong>{recallCard?.ja || 'こんにちは。'}</strong><small>{recallCard?.en || 'Hello / good afternoon.'}</small></div>}
          <div className="recall-actions"><button className={`choice-pill ${warmup === 'remembered' ? 'choice-pill-selected' : ''}`} onClick={() => saveWarmup('remembered')}>I recalled something</button><button className={`choice-pill ${warmup === 'cue' ? 'choice-pill-selected' : ''}`} onClick={() => { saveWarmup('cue', true); setWarmupCue(true) }}>Show me a cue</button><button className={`choice-pill ${warmup === 'skipped' ? 'choice-pill-selected' : ''}`} onClick={() => saveWarmup('skipped')}>Skip for now</button></div>
          <div className="practice-footer"><span className="muted-caption">Your response is private and unscored.</span><button className="primary-button" onClick={() => goStep(1)}>Continue to the scene <ArrowRight size={15} /></button></div>
        </section>}
        {step === 1 && <section className="practice-card">
          <StepLabel number="02" label="SCENE & DIALOGUE" /><h2>Picture the moment.</h2><div className="scene-banner"><Compass size={18} /><span>{lesson.scene}</span></div><div className="text-first-notice"><span className="notice-dot" /> Text-first scene <span>Partner/tutor option: read the lines once at a natural pace with meanings hidden.</span></div>
          <div className="dialogue-list">{lesson.dialogue.map((line, index) => <div className={`dialogue-line ${line.speaker.toLowerCase().includes('traveller') || line.speaker === 'visitor' ? 'dialogue-own' : ''}`} key={`${index}-${line.ja}`}><div className="speaker-label">{labelSpeaker(line.speaker)}</div><div className="dialogue-bubble"><strong lang="ja">{line.ja}</strong>{showMeaning && <span className="dialogue-meaning">{line.en}</span>}<button type="button" className="dialogue-play-button" onClick={() => void tts.playText(line.ja).catch(() => {})} disabled={!tts.modelStatus?.installed || tts.busy} aria-label={`Play ${labelSpeaker(line.speaker)} line in Japanese`} title={tts.modelStatus?.installed ? 'Play with the local voice model' : 'Download the local voice model in Voice Lab'}><Volume2 size={14} /></button></div></div>)}</div>
          {tts.error && <div className="tts-inline-error" role="alert"><span>Local speech: {tts.error}</span></div>}
          <div className="lesson-tools"><button className={`outline-button ${showMeaning ? 'tool-on' : ''}`} onClick={() => setShowMeaning(!showMeaning)}>{showMeaning ? <X size={15} /> : <BookOpen size={15} />}{showMeaning ? 'Hide meanings' : 'Reveal English meanings'}</button><button className={`outline-button ${showPhrases ? 'tool-on' : ''}`} onClick={() => setShowPhrases(!showPhrases)}>{showPhrases ? <X size={15} /> : <Lightbulb size={15} />}{showPhrases ? 'Hide phrase bank' : 'Open phrase bank'}</button></div>
          {showPhrases && <div className="phrase-bank-inline">{week.phraseBank.map((item, index) => <div className="phrase-bank-item" key={`${item.ja}-${index}`}><strong lang="ja">{item.ja}</strong><span>{item.en}</span><small>{item.use}</small></div>)}</div>}
          <div className="practice-footer"><span className="muted-caption">Kana stays visible throughout.</span><button className="primary-button" onClick={() => goStep(2)}>Check what you understood <ArrowRight size={15} /></button></div>
        </section>}
        {step === 2 && <QuestionCard number="03" label="GIST & KEY DETAIL" title="Check what you understood." prompt={lesson.listenCheck.question} choices={lesson.listenCheck.choices} value={listenChoice} setValue={(value) => { setListenChoice(value); setShowListenFeedback(false); onPatch({ listenChoice: value, listenSubmitted: false }) }} submitted={showListenFeedback} correct={listenCorrect} answer={lesson.listenCheck.answer} feedback={listenCorrect ? 'That matches the key detail in the scene.' : `Try again. Look for the detail that answers the question.`} onSubmit={() => submitCheck('listen')} onNext={() => goStep(3)} />}
        {step === 3 && isOpenEndedResponse && <OpenResponseCard prompt={lesson.responsePractice.prompt} guidance={lesson.responsePractice.why} phraseBank={week.phraseBank} value={openResponse} submitted={showResponseFeedback} setValue={(value) => { setOpenResponse(value); setShowResponseFeedback(false); onPatch({ openResponse: value, responseSubmitted: false }) }} onSubmit={() => { setShowResponseFeedback(true); onPatch({ openResponse, responseSubmitted: true }) }} onNext={() => goStep(4)} />}
        {step === 3 && !isOpenEndedResponse && <QuestionCard number="04" label="RESPOND WITH SUPPORT" title="Choose a natural reply." prompt={lesson.responsePractice.prompt} choices={lesson.responsePractice.choices} value={responseChoice} setValue={(value) => { setResponseChoice(value); setShowResponseFeedback(false); onPatch({ responseChoice: value, responseSubmitted: false }) }} submitted={showResponseFeedback} correct={responseCorrect} answer={lesson.responsePractice.answer} feedback={responseCorrect ? lesson.responsePractice.why : 'Not quite in this situation. Try another option, then read why the best fit works.'} onSubmit={() => submitCheck('response')} onNext={() => goStep(4)} why={lesson.responsePractice.why} />}
        {step === 4 && <section className="practice-card">
          <StepLabel number="05" label="ADAPT & WRAP UP" /><h2>Make the exchange yours.</h2><p className="practice-intro">Change one detail or add a follow-up. Try it aloud, with a partner, or as a short written response — no recording or automated scoring.</p>
          <div className="adapt-prompt"><span className="adapt-prompt-icon"><Sparkles size={17} /></span><div><span>YOUR ADAPTATION</span><strong>{lesson.adaptation}</strong></div></div>
          <div className="say-task"><div className="say-task-head"><ListChecks size={16} /><strong>Try the conversation</strong><span>Partner, tutor, or self-led</span></div><p>{lesson.sayTask}</p><button className={`outline-button ${triedAdaptation ? 'tool-on' : ''}`} onClick={markTried}>{triedAdaptation ? <Check size={15} /> : <CircleCheck size={15} />}{triedAdaptation ? 'Attempt noted' : 'I tried the task'}</button></div>
          <label className="field-label" htmlFor="adaptation-note">What did you change? <span>optional reflection</span></label><textarea id="adaptation-note" className="reflection-input" rows="3" placeholder="A new place, item, time, or follow-up…" value={adaptation} onChange={(event) => updateAdaptation(event.target.value)} />
          {priorFunctionWeek && <div className="checkpoint-revisit"><div className="checkpoint-revisit-icon"><Target size={15} /></div><div><span>Checkpoint revisit · Week {String(priorFunctionWeek.week).padStart(2, '0')}</span><strong>Mix in this earlier function: {priorFunctionWeek.canDo}</strong></div></div>}
          <div className="context-learning"><div className="context-head"><BookOpen size={16} /><strong>Notice the writing</strong></div><div className="kana-groups">{week.kanaFocus.map((group) => <span key={group}>{group}</span>)}</div>{week.kanjiCards.length > 0 && <div className="kanji-card-row">{week.kanjiCards.map((item) => <div className="mini-kanji-card" key={item.kanji}><strong lang="ja">{item.kanji}</strong><span>{item.reading} · {item.meaning}</span><small>{item.whyHere}</small></div>)}</div>}</div>
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

function OpenResponseCard({ prompt, guidance, phraseBank, value, submitted, setValue, onSubmit, onNext }) {
  return <section className="practice-card question-card">
    <StepLabel number="04" label="OPEN-ENDED RESPONSE" /><h2>Make a flexible reply.</h2><p className="question-prompt">{prompt}</p>
    <label className="field-label" htmlFor="open-response">Try your reply in Japanese <span>not scored</span></label>
    <textarea id="open-response" lang="ja" className="reflection-input open-response-input" rows="4" placeholder="Write a phrase or a few lines you would try…" value={value} onChange={(event) => setValue(event.target.value)} />
    {submitted && <div className="open-response-guidance" role="status"><strong>No single answer key</strong><p>{guidance}</p></div>}
    {submitted && phraseBank?.length > 0 && <div className="phrase-bank-inline">{phraseBank.map((item, index) => <div className="phrase-bank-item" key={`${item.ja}-${index}`}><strong lang="ja">{item.ja}</strong><span>{item.en}</span><small>{item.use}</small></div>)}</div>}
    <div className="practice-footer"><span className="muted-caption">Try first; then compare with the guidance and phrase bank.</span>{submitted ? <button className="primary-button" onClick={onNext}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" onClick={onSubmit} disabled={!value.trim()}>Compare my reply <ArrowRight size={15} /></button>}</div>
  </section>
}

function QuestionCard({ number, label, title, prompt, choices, value, setValue, submitted, correct, answer, feedback, onSubmit, onNext, why }) {
  const hasAnswer = value !== null && value !== undefined
  return <section className="practice-card question-card"><StepLabel number={number} label={label} /><h2>{title}</h2><p className="question-prompt">{prompt}</p><div className="answer-options">{choices.map((choice, index) => <button key={`${index}-${choice}`} className={`answer-option ${value === index ? 'answer-option-selected' : ''} ${submitted && value === index && correct ? 'answer-option-correct' : ''} ${submitted && value === index && !correct ? 'answer-option-wrong' : ''}`} onClick={() => setValue(index)}><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span lang="ja">{choice}</span>{submitted && value === index && correct && <Check size={16} />}</button>)}</div>
    {submitted && <div className={`feedback-box ${correct ? 'feedback-good' : 'feedback-retry'}`}><span>{correct ? <Check size={16} /> : <RotateCcw size={16} />}</span><div><strong>{correct ? 'Good catch' : 'Keep exploring'}</strong><p>{feedback}{why && correct ? ` ${why}` : ''}</p></div></div>}
    <div className="practice-footer"><span className="muted-caption">A task-level check — not a proficiency score.</span>{submitted && correct ? <button className="primary-button" onClick={onNext}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" onClick={submitted && !correct ? () => { setValue(null) } : onSubmit} disabled={!hasAnswer}>{submitted && !correct ? 'Try another answer' : 'Check my answer'} <ArrowRight size={15} /></button>}</div>
  </section>
}

function ReviewPage({ cards, onRate, onPhrasebook }) {
  const [queueIds] = useState(() => new Set(cards.map((card) => card.id)))
  const [reviewedIds, setReviewedIds] = useState(() => new Set())
  const [flipped, setFlipped] = useState(false)
  const current = cards.find((card) => queueIds.has(card.id) && !reviewedIds.has(card.id))
  const queueSize = queueIds.size
  const reviewedCount = reviewedIds.size
  function rate(rating) {
    if (!current) return
    onRate(current.id, rating)
    setFlipped(false)
    setReviewedIds((known) => new Set([...known, current.id]))
  }
  const remaining = Math.max(0, queueSize - reviewedCount)
  return <div className="content-page review-page page-enter">
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-line" /> SHORT, SPACED PRACTICE</div><h1>Review cards<span className="title-period">.</span></h1><p>Try to recall first, flip for the meaning, then choose how easily it came back.</p></div>
    <div className="review-summary"><div className="summary-icon"><RotateCcw size={19} /></div><div><strong>{queueSize ? `${queueSize} cards in today’s short session` : 'All caught up for today'}</strong><span>Cards come from your unlocked course phrases, kana focus, and practical kanji.</span></div><span className="review-progress-text">{queueSize ? `${reviewedCount} / ${queueSize} reviewed` : 'Queue complete'}</span></div>
    {!current ? <div className="empty-review panel"><div className="empty-icon"><Sparkles size={21} /></div><h2>Nice work. You’re done for now.</h2><p>{queueSize ? 'You have finished today’s selected cards. More come back as they become due.' : 'Start a lesson to add useful phrases to your spaced-retrieval deck.'}</p><button className="primary-button" onClick={onPhrasebook}>Browse phrasebook <ArrowRight size={15} /></button></div> : <div className="flashcard-wrap">
      <div className="flashcard-meta"><span className={`type-pill type-${current.type}`}>{current.type}</span><span>Week {String(current.week).padStart(2, '0')}</span><span className="flashcard-index">CARD {String(reviewedCount + 1).padStart(2, '0')}</span></div>
      <button className={`flashcard ${flipped ? 'flashcard-flipped' : ''}`} onClick={() => setFlipped((value) => !value)} aria-label={flipped ? 'Show card front' : 'Reveal answer'}>
        <span className="flashcard-corner">{flipped ? 'ANSWER' : 'RECALL'}</span>{flipped ? <><span className="flashcard-main" lang="ja">{current.back}</span>{current.detail && <span className="flashcard-detail">{current.detail}</span>}</> : <><span className="flashcard-main" lang="ja">{current.front}</span><span className="flashcard-hint">Think of the meaning, then tap to reveal.</span></>}
        <span className="flashcard-flip">{flipped ? 'Tap to see prompt' : 'Tap to reveal'} <RotateCcw size={13} /></span>
      </button>
      {flipped ? <div className="rating-row"><span>How easy was that?</span><div><button className="rating-button rating-again" onClick={() => rate('again')}>Again<small>1 day</small></button><button className="rating-button rating-hard" onClick={() => rate('hard')}>Hard<small>short interval</small></button><button className="rating-button rating-good" onClick={() => rate('good')}>Good<small>steady interval</small></button><button className="rating-button rating-easy" onClick={() => rate('easy')}>Easy<small>longer interval</small></button></div></div> : <div className="flip-instruction"><RotateCcw size={14} /> Reveal the meaning when you’ve had a try</div>}
      <div className="review-footer"><span>Scheduled locally · no memory score</span><button className="text-link" onClick={onPhrasebook}>Open phrasebook <ArrowRight size={14} /></button></div>
    </div>}
    <div className="review-footnote"><Lightbulb size={15} /><span>Missed a phrase? It returns sooner. Recalled it easily? It will wait longer before the next review.</span></div>
  </div>
}

function PhrasebookPage({ cards, search, setSearch }) {
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
    <div className="phrase-tools"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Japanese, meaning, or use…" /></label><div className="filter-tabs">{[['all', 'All'], ['phrase', 'Phrases'], ['kana', 'Kana'], ['kanji', 'Kanji']].map(([key, label]) => <button key={key} className={filter === key ? 'filter-active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    <div className="phrase-count">{filtered.length} {filter === 'all' ? 'learning cards' : `${filter} cards`}</div>
    <div className="phrase-grid">{filtered.map((card) => {
      const isOpen = revealed.has(card.id)
      return <button className={`phrase-card phrase-${card.type}`} key={card.id} onClick={() => toggle(card.id)}><div className="phrase-card-top"><span className={`type-pill type-${card.type}`}>{card.type}</span><span>W{String(card.week).padStart(2, '0')}</span></div><strong className="phrase-front" lang="ja">{card.front}</strong><div className={`phrase-back ${isOpen ? 'phrase-back-open' : ''}`}><span>{card.back}</span>{card.detail && <small>{card.detail}</small>}</div><div className="phrase-card-foot">{isOpen ? 'Tap to close' : 'Tap to reveal meaning'} <ChevronDown size={14} /></div></button>
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

function SettingsPage({ theme, textScale, onThemeChange, onTextScaleChange }) {
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
    <div className="settings-local-note"><LockKeyhole size={16} /><span>These settings and your learning progress are stored locally on this device.</span></div>
  </div>
}

export default App
