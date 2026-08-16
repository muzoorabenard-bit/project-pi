import { cn } from '@/lib/utils'
import type { Recommendation } from '@/hooks/useRecommendations'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

const confidenceStyles = {
  High: 'bg-green-100 text-green-800 border-green-200',
  Medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Low: 'bg-slate-100 text-slate-700 border-slate-200',
}

const resultStyles: Record<string, string> = {
  Win: 'bg-green-500 text-white',
  Loss: 'bg-red-500 text-white',
  Void: 'bg-slate-400 text-white',
  Pending: 'bg-blue-100 text-blue-700',
}

function pickOdds(rec: Recommendation): number | null {
  const { pick, matches: m } = rec
  if (!m) return null
  if (pick === 'Home Win') return m.home_odds
  if (pick === 'Away Win') return m.away_odds
  if (pick === 'Draw') return m.draw_odds
  return null
}

export function MatchCard({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false)
  const m = rec.matches
  const odds = pickOdds(rec)
  const resultLabel = rec.result ?? 'Pending'

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{m.league}</span>
          <span className="text-xs text-slate-400">
            {new Date(m.kickoff_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          <span className="font-semibold text-slate-800 flex-1">{m.home_team}</span>
          <span className="text-slate-400 text-sm font-medium">vs</span>
          <span className="font-semibold text-slate-800 flex-1 text-right">{m.away_team}</span>
        </div>
      </div>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-slate-700">{rec.pick}</span>
        <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', confidenceStyles[rec.confidence])}>
          {rec.confidence}
        </span>
        {odds && (
          <span className="text-xs text-slate-500 ml-auto">@ {odds.toFixed(2)}</span>
        )}
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', resultStyles[resultLabel] ?? resultStyles.Pending)}>
          {resultLabel}
        </span>
      </div>

      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-5 py-2 flex items-center justify-between text-xs text-slate-500 hover:bg-slate-50 transition-colors"
      >
        <span>AI Reasoning</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-5 pb-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100">
          {rec.reasoning}
        </div>
      )}
    </div>
  )
}
