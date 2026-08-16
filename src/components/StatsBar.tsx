import type { Recommendation } from '@/hooks/useRecommendations'

export function StatsBar({ recs }: { recs: Recommendation[] }) {
  const settled = recs.filter(r => r.result === 'Win' || r.result === 'Loss')
  const wins = settled.filter(r => r.result === 'Win').length
  const hitRate = settled.length ? Math.round((wins / settled.length) * 100) : null

  return (
    <div className="flex gap-6 text-sm text-slate-600">
      <span>
        <span className="font-semibold text-slate-800">{recs.length}</span> picks
      </span>
      <span>
        <span className="font-semibold text-green-700">{wins}</span> wins
      </span>
      <span>
        <span className="font-semibold text-slate-800">
          {hitRate !== null ? `${hitRate}%` : '—'}
        </span>{' '}
        hit rate
      </span>
    </div>
  )
}
