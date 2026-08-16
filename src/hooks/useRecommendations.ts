import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Recommendation {
  id: string
  bet_type: string
  pick: string
  confidence: 'High' | 'Medium' | 'Low'
  reasoning: string
  result: string | null
  created_at: string
  matches: {
    home_team: string
    away_team: string
    league: string
    kickoff_time: string
    home_odds: number
    draw_odds: number
    away_odds: number
  }
}

export function useRecommendations(date?: string) {
  return useQuery({
    queryKey: ['recommendations', date ?? 'today'],
    queryFn: async () => {
      const from = date
        ? new Date(date)
        : new Date(new Date().setHours(0, 0, 0, 0))
      const to = new Date(from)
      to.setDate(to.getDate() + 1)

      const { data, error } = await supabase
        .from('recommendations')
        .select(`*, matches(home_team, away_team, league, kickoff_time, home_odds, draw_odds, away_odds)`)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString())
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Recommendation[]
    },
  })
}

export function useHistory() {
  return useQuery({
    queryKey: ['recommendations', 'history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recommendations')
        .select(`*, matches(home_team, away_team, league, kickoff_time, home_odds, draw_odds, away_odds)`)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return data as Recommendation[]
    },
  })
}
