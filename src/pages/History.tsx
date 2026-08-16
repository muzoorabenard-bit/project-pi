import { useState } from 'react'
import { useHistory } from '@/hooks/useRecommendations'
import { MatchCard } from '@/components/MatchCard'
import { LeagueFilter } from '@/components/LeagueFilter'
import { StatsBar } from '@/components/StatsBar'

export default function History() {
  const [league, setLeague] = useState('All')
  const { data, isLoading, error } = useHistory()

  const all = data ?? []
  const filtered = all.filter(r => league === 'All' || r.matches?.league === league)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">History</h1>
        <p className="text-sm text-slate-500">All past recommendations</p>
      </div>

      <div className="mb-4">
        <StatsBar recs={all} />
      </div>

      <div className="mb-5">
        <LeagueFilter selected={league} onChange={setLeague} />
      </div>

      {isLoading && (
        <div className="text-center py-12 text-slate-400">Loading history…</div>
      )}
      {error && (
        <div className="text-center py-12 text-red-500">Failed to load history.</div>
      )}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400">No past picks found.</div>
      )}

      <div className="flex flex-col gap-4">
        {filtered.map(rec => (
          <MatchCard key={rec.id} rec={rec} />
        ))}
      </div>
    </div>
  )
}
