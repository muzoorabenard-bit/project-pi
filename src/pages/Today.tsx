import { useState } from 'react'
import { useRecommendations } from '@/hooks/useRecommendations'
import { MatchCard } from '@/components/MatchCard'
import { LeagueFilter } from '@/components/LeagueFilter'

export default function Today() {
  const [league, setLeague] = useState('All')
  const { data, isLoading, error } = useRecommendations()

  const picks = (data ?? []).filter(
    r => league === 'All' || r.matches?.league === league,
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Today's Picks</h1>
        <p className="text-sm text-slate-500">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="mb-5">
        <LeagueFilter selected={league} onChange={setLeague} />
      </div>

      {isLoading && (
        <div className="text-center py-12 text-slate-400">Loading picks…</div>
      )}
      {error && (
        <div className="text-center py-12 text-red-500">Failed to load picks.</div>
      )}
      {!isLoading && !error && picks.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          No picks yet for today. Check back after 5 AM UTC.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {picks.map(rec => (
          <MatchCard key={rec.id} rec={rec} />
        ))}
      </div>
    </div>
  )
}
