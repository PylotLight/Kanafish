import { Check, Compass, ArrowRight } from 'lucide-react'

export default function WeeklyTimelineWidget({ week, progress, onOpenLesson }) {
  if (!week) return null
  const completed = new Set(progress.completedLessonIds || [])
  const doneCount = week.lessons.filter((l) => completed.has(l.id)).length

  return (
    <div className="weekly-timeline-card modern-timeline">
      <div className="weekly-timeline-header">
        <div className="weekly-timeline-title">
          <Compass size={14} className="timeline-icon" />
          <div className="timeline-title-meta">
            <strong>Week {String(week.week).padStart(2, '0')}: {week.title}</strong>
            <small>{week.canDo}</small>
          </div>
        </div>
        <span className="weekly-timeline-badge">{doneCount}/{week.lessons.length} done</span>
      </div>

      <div className="timeline-node-track">
        {week.lessons.map((lesson, idx) => {
          const isDone = completed.has(lesson.id)
          const session = progress.lessonSessions?.[lesson.id]
          const isStarted = !isDone && (session?.step ?? 0) > 0
          const stageLabel = ({ recognize: 'Notice', 'supported-response': 'Practice', adapt: 'Adapt' })[lesson.stage]

          return (
            <button
              key={lesson.id}
              type="button"
              className={`timeline-node-item ${isDone ? 'is-done' : ''} ${isStarted ? 'is-started' : ''}`}
              onClick={() => onOpenLesson(lesson.id)}
              title={`${lesson.title} - ${lesson.goal}`}
            >
              <div className="node-marker">
                {isDone ? <Check size={11} /> : idx + 1}
              </div>
              <div className="node-info">
                <span className="node-stage">{stageLabel}</span>
                <strong className="node-title">{lesson.title}</strong>
              </div>
              <ArrowRight size={12} className="node-arrow" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
