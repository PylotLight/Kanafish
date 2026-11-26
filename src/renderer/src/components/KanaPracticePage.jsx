import { useState } from 'react'
import { ArrowRight, Check, CircleCheck, RotateCcw, Volume2 } from 'lucide-react'
import {
  KANA_UNITS, buildKanaQuiz, getKanaScriptStats, getKanaUnitStats, isKanaItemMastered,
} from '../../kana-curriculum.js'

function todayISO() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

function listen(text, tts, voiceContext = {}) {
  if (!text || !tts?.activeEngineStatus?.ready || tts.busy) return
  void tts.playText(text, voiceContext).catch(() => {})
}

function unitStatusLabel(status) {
  return status === 'solid' ? 'Solid' : status === 'practising' ? 'In practice' : 'New'
}

export default function KanaPracticePage({ progress, cards, course, tts, onRate, onOpenCourse }) {
  const [script, setScript] = useState('hiragana')
  const [selectedUnitId, setSelectedUnitId] = useState('hira-vowels-k')
  const [quiz, setQuiz] = useState([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answered, setAnswered] = useState(null)
  const [score, setScore] = useState(0)
  const [complete, setComplete] = useState(false)
  const units = KANA_UNITS.filter((unit) => unit.script === script)
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0]
  const unitIndex = Math.max(0, units.findIndex((unit) => unit.id === selectedUnit?.id))
  const scriptStats = getKanaScriptStats(progress, script)
  const question = quiz[questionIndex]
  const voiceReady = Boolean(tts?.activeEngineStatus?.ready)
  const courseWeek = course?.weeks?.find((week) => week.week === (script === 'hiragana' ? 1 : 2))
  const example = courseWeek?.phraseBank?.[0]
  const exampleVoiceContext = { weekNumber: courseWeek?.week || 1, lessonNumber: 1 }

  function selectScript(nextScript) {
    setScript(nextScript)
    setSelectedUnitId(nextScript === 'hiragana' ? 'hira-vowels-k' : 'kata-vowels-k')
    setQuiz([])
    setAnswered(null)
    setComplete(false)
  }

  function selectUnit(unitId) {
    setSelectedUnitId(unitId)
    setQuiz([])
    setAnswered(null)
    setComplete(false)
  }

  function startPractice() {
    if (!selectedUnit) return
    const today = todayISO()
    const priorItems = units.slice(0, unitIndex).flatMap((unit) => unit.items).filter((item) => {
      const schedule = progress?.flashcards?.[item.id]
      return schedule?.lastRating === 'again' || Boolean(schedule?.dueDate && schedule.dueDate <= today)
    }).sort((left, right) => {
      const leftSchedule = progress?.flashcards?.[left.id]
      const rightSchedule = progress?.flashcards?.[right.id]
      const leftRank = leftSchedule?.lastRating === 'again' ? 0 : 1
      const rightRank = rightSchedule?.lastRating === 'again' ? 0 : 1
      return leftRank - rightRank || (leftSchedule?.dueDate || '').localeCompare(rightSchedule?.dueDate || '')
    }).slice(0, 3)
    const practicePool = [...selectedUnit.items, ...priorItems]
    const nextQuiz = buildKanaQuiz(practicePool, practicePool, progress, today, 10)
    setQuiz(nextQuiz)
    setQuestionIndex(0)
    setAnswered(null)
    setScore(0)
    setComplete(false)
  }

  function answerQuestion(choice) {
    if (!question || answered) return
    const correct = choice === question.answer
    const card = cards.find((item) => item.id === question.id)
    if (card) onRate(card, correct ? 'good' : 'again')
    if (correct) setScore((value) => value + 1)
    setAnswered({ choice, correct })
  }

  function continueQuiz() {
    if (!answered) return
    if (questionIndex + 1 >= quiz.length) {
      setComplete(true)
      return
    }
    setQuestionIndex((value) => value + 1)
    setAnswered(null)
  }

  const unitStats = getKanaUnitStats(progress, selectedUnit)
  const exampleText = example?.ja || courseWeek?.lessons?.[0]?.dialogue?.[0]?.ja || ''
  const exampleMeaning = example?.en || courseWeek?.lessons?.[0]?.dialogue?.[0]?.en || ''

  return <div className="content-page kana-practice-page page-enter">
    <div className="page-intro">
      <div className="eyebrow"><span className="eyebrow-line" /> SHORT DAILY RETRIEVAL · CONVERSATION IN CONTEXT</div>
      <h1>Kana practice<span className="title-period">.</span></h1>
      <p>Learn a small set, retrieve it in both directions, and revisit it through Kanafish’s spaced-review queue. Seven core sessions per script cover the full modern kana set; one optional pattern session for each adds yōon, small kana, and common loanword spellings. The full 16-session path fits a brisk two-to-three-week pace.</p>
    </div>

    <div className="kana-sprint-summary panel">
      <div className="kana-sprint-mark"><span lang="ja">あ</span><span lang="ja">ア</span></div>
      <div className="kana-sprint-copy">
        <span className="eyebrow">CORE SCRIPT COVERAGE</span>
        <strong>{script === 'hiragana' ? 'Hiragana' : 'Katakana'} · {scriptStats.coreMastered}/{scriptStats.coreTotal} solid</strong>
        <small>{scriptStats.coreSeen} seen · solid means two successful study days on an individual item.</small>
      </div>
      <div className="kana-pattern-progress"><strong>{scriptStats.patternMastered}/{scriptStats.patternTotal}</strong><small>patterns solid</small></div>
    </div>

    <div className="kana-script-tabs" role="group" aria-label="Choose a kana script">
      <button type="button" className={script === 'hiragana' ? 'is-selected' : ''} aria-pressed={script === 'hiragana'} onClick={() => selectScript('hiragana')}>Hiragana <small>Sessions 1–8</small></button>
      <button type="button" className={script === 'katakana' ? 'is-selected' : ''} aria-pressed={script === 'katakana'} onClick={() => selectScript('katakana')}>Katakana <small>Sessions 9–16</small></button>
    </div>

    <section className="kana-practice-layout">
      <aside className="kana-unit-panel panel" aria-label="Practice sequence">
        <div className="kana-panel-heading"><div><span className="eyebrow">SUGGESTED SEQUENCE</span><h2>{script === 'hiragana' ? 'Hiragana' : 'Katakana'} sets</h2></div><span className="kana-session-count">{units.length} sessions</span></div>
        <p className="kana-sequence-note">One short session a day is a brisk two-to-three-week pace. Move at your own speed; nothing here gates the conversation course.</p>
        <div className="kana-unit-list">
          {units.map((unit) => {
            const stats = getKanaUnitStats(progress, unit)
            return <button type="button" key={unit.id} className={`kana-unit-button ${selectedUnit?.id === unit.id ? 'is-current' : ''}`} onClick={() => selectUnit(unit.id)} aria-current={selectedUnit?.id === unit.id ? 'step' : undefined}>
              <span className={`kana-unit-index ${stats.status === 'solid' ? 'is-solid' : ''}`}>{String(unit.session).padStart(2, '0')}</span>
              <span className="kana-unit-copy"><strong>{unit.label}</strong><small>{stats.mastered}/{stats.total} solid</small></span>
              <span className={`kana-unit-status status-${stats.status}`}>{unitStatusLabel(stats.status)}</span>
            </button>
          })}
        </div>
      </aside>

      <div className="kana-main-column">
        <section className="kana-selected-unit panel">
          <div className="kana-panel-heading">
            <div><span className="eyebrow">SESSION {String(selectedUnit?.session || 1).padStart(2, '0')} · {selectedUnit?.kind === 'pattern' ? 'PATTERN EXTENSION' : 'CORE KANA'}</span><h2>{selectedUnit?.label}</h2></div>
            <span className="kana-unit-score">{unitStats.mastered}/{unitStats.total} solid</span>
          </div>
          <p className="kana-unit-description">{selectedUnit?.description}</p>
          <div className="kana-item-grid" aria-label={`${selectedUnit?.label} practice items`}>
            {selectedUnit?.items.map((item) => {
              const mastered = isKanaItemMastered(progress, item)
              const attempts = progress?.kanaRecall?.[item.id]?.attempts ?? 0
              return <button type="button" key={item.id} className={`kana-item-tile ${mastered ? 'is-mastered' : attempts ? 'is-seen' : ''}`} onClick={() => listen(item.kana, tts, { weekNumber: item.week })} disabled={!voiceReady || tts?.busy} aria-label={`Listen to ${item.kana}, ${item.reading}`} title={`${item.kana} · ${item.reading}`}>
                <span lang="ja">{item.kana}</span><small>{mastered ? <CircleCheck size={12} /> : item.reading}</small>
              </button>
            })}
          </div>
          <div className="kana-practice-controls">
            <span className="kana-audio-hint"><Volume2 size={14} /> {voiceReady ? 'Select any tile to hear it.' : 'Audio is optional; set up a local Japanese voice in Voice Lab.'}</span>
            <button type="button" className="primary-button" onClick={startPractice}><RotateCcw size={15} /> Start 10-question practice <ArrowRight size={15} /></button>
          </div>
        </section>

        {quiz.length > 0 && <section className="kana-quiz-card panel" aria-live="polite">
          {complete ? <div className="kana-quiz-complete">
            <div className="kana-complete-icon"><Check size={20} /></div><span className="eyebrow">PRACTICE SAVED TO SPACED REVIEW</span>
            <h2>{score} of {quiz.length} correct</h2><p>Missed items return sooner in the review queue. Individual kana become solid after successful recall on two different days.</p>
            <div className="kana-quiz-actions"><button type="button" className="primary-button" onClick={startPractice}>Practice this set again <RotateCcw size={14} /></button><button type="button" className="text-link" onClick={() => setQuiz([])}>Back to sets</button></div>
          </div> : question && <>
            <div className="kana-quiz-top"><span className="eyebrow">QUESTION {String(questionIndex + 1).padStart(2, '0')} / {String(quiz.length).padStart(2, '0')}</span><span className="kana-score-badge">{score} correct</span></div>
            <p className="kana-question-prompt">{question.direction === 'symbol-to-sound' ? 'What sound does this kana represent?' : 'Which kana represents this sound?'}</p>
            <div className={`kana-question-main ${question.direction === 'symbol-to-sound' ? 'kana-question-symbol' : ''}`} lang={question.direction === 'symbol-to-sound' ? 'ja' : 'ja-Latn'}>{question.prompt}</div>
            <div className="kana-answer-options" role="group" aria-label="Answer choices">
              {question.options.map((option) => {
                const isSelected = answered?.choice === option
                const isCorrectOption = option === question.answer
                return <button type="button" key={option} className={`kana-answer-option ${answered && isCorrectOption ? 'is-correct' : ''} ${isSelected && answered && !answered.correct ? 'is-wrong' : ''}`} onClick={() => answerQuestion(option)} disabled={Boolean(answered)} aria-pressed={isSelected}>
                  <span lang={question.direction === 'symbol-to-sound' ? 'ja-Latn' : 'ja'}>{option}</span>
                  {answered && isCorrectOption && <Check size={16} />}
                </button>
              })}
            </div>
            {answered && <div className={`kana-answer-feedback ${answered.correct ? 'is-good' : 'is-retry'}`} role="status">
              <strong>{answered.correct ? 'Good recall' : 'This one needs another look'}</strong>
              <span lang="ja">{question.item.kana} · {question.item.reading}</span>
            </div>}
            <div className="kana-quiz-footer"><span>{answered ? 'Your answer is recorded in the shared SRS.' : 'Choose from memory before revealing the answer.'}</span>{answered && <button type="button" className="primary-button" onClick={continueQuiz}>{questionIndex + 1 >= quiz.length ? 'Finish session' : 'Next question'} <ArrowRight size={15} /></button>}</div>
          </>}
        </section>}

        <section className="kana-application-card panel">
          <div className="kana-application-copy"><span className="eyebrow">APPLY IT IN CONVERSATION</span><h2>From sound patterns to real lines</h2>
            {exampleText && <><strong lang="ja">{exampleText}</strong><small>{exampleMeaning}</small></>}
            <p>The Week {courseWeek?.week || (script === 'hiragana' ? 1 : 2)} conversations reuse these sounds. Kana practice and lesson completion are tracked separately, so speaking practice stays open.</p>
          </div>
          <button type="button" className="kana-example-listen" onClick={() => listen(exampleText, tts, exampleVoiceContext)} disabled={!exampleText || !voiceReady || tts?.busy} aria-label={`Listen to the Week ${courseWeek?.week || 1} conversation example`}><Volume2 size={16} />Listen</button>
          <button type="button" className="text-link kana-course-link" onClick={() => onOpenCourse(script === 'hiragana' ? 1 : 2)}>Open Week {script === 'hiragana' ? '1' : '2'} lessons <ArrowRight size={14} /></button>
        </section>
      </div>
    </section>
  </div>
}
