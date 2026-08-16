import { cn } from '@/lib/utils'

const LEAGUES = ['All', 'EPL', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1']

export function LeagueFilter({
  selected,
  onChange,
}: {
  selected: string
  onChange: (league: string) => void
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {LEAGUES.map(l => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
            selected === l
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
