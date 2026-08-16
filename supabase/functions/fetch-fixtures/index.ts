import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FOOTBALL_DATA_KEY = Deno.env.get('FOOTBALL_DATA_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANALYZE_URL = `${SUPABASE_URL}/functions/v1/analyze-matches`
// Same dedicated ops bot as analyze-matches/settle-results — see
// settle-results/index.ts for why this is a distinct pair from
// TELEGRAM_BOT_TOKEN/CHAT_ID (project-lydia's shared bot).
const AI_BET_TELEGRAM_BOT_TOKEN = Deno.env.get('AI_BET_TELEGRAM_BOT_TOKEN')
const AI_BET_TELEGRAM_CHAT_ID = Deno.env.get('AI_BET_TELEGRAM_CHAT_ID')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function notifyOps(text: string): Promise<void> {
  if (!AI_BET_TELEGRAM_BOT_TOKEN || !AI_BET_TELEGRAM_CHAT_ID) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${AI_BET_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: AI_BET_TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) console.error(`ops notification failed: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error(`ops notification threw: ${err}`)
  }
}

const COMPETITION_MAP: Record<string, string> = {
  PL:  'EPL',
  PD:  'La Liga',
  BL1: 'Bundesliga',
  SA:  'Serie A',
  FL1: 'Ligue 1',
}

async function fd(endpoint: string) {
  const res = await fetch(`https://api.football-data.org/v4/${endpoint}`, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY },
  })
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${await res.text()}`)
  return res.json()
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

interface StandingEntry {
  position: number
  points: number
  gapToRelegation: number
  gapToTop4: number
  totalTeams: number
}

async function fetchStandings(): Promise<Map<number, StandingEntry>> {
  const map = new Map<number, StandingEntry>()
  for (const code of Object.keys(COMPETITION_MAP)) {
    await delay(7000)
    try {
      const data = await fd(`competitions/${code}/standings`)
      const table: { team: { id: number }; position: number; points: number }[] =
        data.standings?.[0]?.table ?? []
      if (!table.length) continue

      const totalTeams = table.length
      const relegationCutoff = table[totalTeams - 3]?.points ?? 0
      const top4Points = table[3]?.points ?? table[0]?.points ?? 0

      for (const row of table) {
        map.set(row.team.id, {
          position: row.position,
          points: row.points,
          gapToRelegation: row.points - relegationCutoff,
          gapToTop4: top4Points - row.points,
          totalTeams,
        })
      }
    } catch {
      // standings fetch failure is non-fatal
    }
  }
  return map
}

Deno.serve(async () => {
  try {
    // 1. Fetch next 8 days of scheduled matches in ONE request
    const from = new Date()
    const to   = new Date(); to.setDate(to.getDate() + 8)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr   = to.toISOString().slice(0, 10)
    const codes   = Object.keys(COMPETITION_MAP).join(',')

    const allFixtures = await fd(
      `matches?dateFrom=${fromStr}&dateTo=${toStr}&competitions=${codes}&status=SCHEDULED`,
    )

    if (!allFixtures.matches?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: 'No fixtures in next 8 days' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 2. Find the earliest date that has matches
    const dates = [...new Set<string>(
      allFixtures.matches.map((m: { utcDate: string }) => m.utcDate.slice(0, 10)),
    )].sort()
    const targetDate = dates[0]
    const dayMatches = allFixtures.matches.filter(
      (m: { utcDate: string }) => m.utcDate.slice(0, 10) === targetDate,
    )

    // 3. Collect unique team IDs
    const teamIds = new Set<number>()
    for (const m of dayMatches) {
      teamIds.add(m.homeTeam.id)
      teamIds.add(m.awayTeam.id)
    }

    // 4. Check cache — skip teams updated within last 24h that have strategy columns
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: cached } = await supabase
      .from('team_stats')
      .select('team_id')
      .gt('updated_at', cutoff)
      .not('home_wins_last6', 'is', null)
    const cachedIds = new Set((cached ?? []).map((s: { team_id: number }) => s.team_id))
    const toFetch = [...teamIds].filter(id => !cachedIds.has(id))

    // Only fetch standings if there are teams that need refreshing (saves 35s on cache-hit days)
    const standings = toFetch.length > 0 ? await fetchStandings() : new Map()

    // 5. Fetch and compute stats for each team
    for (const teamId of toFetch) {
      await delay(7000)
      let teamMatchData
      try {
        teamMatchData = await fd(`teams/${teamId}/matches?status=FINISHED&limit=10`)
      } catch {
        continue
      }
      const matches: {
        homeTeam: { id: number }
        awayTeam: { id: number }
        score: { fullTime: { home: number | null; away: number | null } }
      }[] = teamMatchData.matches ?? []
      if (!matches.length) continue

      const ref = dayMatches.find(
        (m: { homeTeam: { id: number }; awayTeam: { id: number } }) =>
          m.homeTeam.id === teamId || m.awayTeam.id === teamId,
      )
      const teamName: string = ref?.homeTeam.id === teamId ? ref.homeTeam.name : ref?.awayTeam.name
      const league: string = COMPETITION_MAP[ref?.competition?.code] ?? 'Unknown'

      // Overall stats (all 10)
      let totalScored = 0, totalConceded = 0, cleanSheets10 = 0, formStr = ''
      for (const match of matches) {
        const home = match.homeTeam.id === teamId
        const gs = home ? (match.score.fullTime.home ?? 0) : (match.score.fullTime.away ?? 0)
        const gc = home ? (match.score.fullTime.away ?? 0) : (match.score.fullTime.home ?? 0)
        totalScored += gs
        totalConceded += gc
        if (gc === 0) cleanSheets10++
        if (formStr.length < 5) formStr += gs > gc ? 'W' : gs === gc ? 'D' : 'L'
      }

      // Home stats (last 6 home games)
      const homeMatches = matches.filter(m => m.homeTeam.id === teamId).slice(0, 6)
      let homeWins = 0, homeDraws = 0, homeLosses = 0, homeScored = 0, homeConceded = 0
      let homeUnbeatenStreak = 0, streakBroken = false
      for (const match of homeMatches) {
        const gs = match.score.fullTime.home ?? 0
        const gc = match.score.fullTime.away ?? 0
        homeScored += gs
        homeConceded += gc
        if (gs > gc) homeWins++
        else if (gs === gc) homeDraws++
        else { homeLosses++; if (!streakBroken) streakBroken = true }
        if (!streakBroken) homeUnbeatenStreak++
      }

      // Away stats (last 6 away games)
      const awayMatches = matches.filter(m => m.awayTeam.id === teamId).slice(0, 6)
      let awayWins = 0, awayScored = 0, awayConceded = 0
      for (const match of awayMatches) {
        const gs = match.score.fullTime.away ?? 0
        const gc = match.score.fullTime.home ?? 0
        awayScored += gs
        awayConceded += gc
        if (gs > gc) awayWins++
      }

      const played = matches.length
      const homePlayed = homeMatches.length || 1
      const awayPlayed = awayMatches.length || 1

      // Merge standings data
      const standing = standings.get(teamId)

      await supabase.from('team_stats').upsert({
        team_id: teamId,
        team_name: teamName,
        league,
        form: formStr,
        goals_scored_avg: +(totalScored / played).toFixed(2),
        goals_conceded_avg: +(totalConceded / played).toFixed(2),
        btts_rate: +(matches.filter(m => {
          const gs = m.homeTeam.id === teamId ? (m.score.fullTime.home ?? 0) : (m.score.fullTime.away ?? 0)
          const gc = m.homeTeam.id === teamId ? (m.score.fullTime.away ?? 0) : (m.score.fullTime.home ?? 0)
          return gs > 0 && gc > 0
        }).length / played).toFixed(2),
        over25_rate: +(matches.filter(m => {
          const h = m.score.fullTime.home ?? 0
          const a = m.score.fullTime.away ?? 0
          return h + a > 2
        }).length / played).toFixed(2),
        clean_sheets_last10: cleanSheets10,
        // Home splits
        home_wins_last6: homeWins,
        home_draws_last6: homeDraws,
        home_losses_last6: homeLosses,
        home_unbeaten_streak: homeUnbeatenStreak,
        home_goals_scored_avg: +(homeScored / homePlayed).toFixed(2),
        home_goals_conceded_avg: +(homeConceded / homePlayed).toFixed(2),
        // Away splits
        away_wins_last6: awayWins,
        away_goals_scored_avg: +(awayScored / awayPlayed).toFixed(2),
        away_goals_conceded_avg: +(awayConceded / awayPlayed).toFixed(2),
        // Standings
        league_position: standing?.position ?? null,
        league_points: standing?.points ?? null,
        gap_to_relegation: standing?.gapToRelegation ?? null,
        gap_to_top4: standing?.gapToTop4 ?? null,
        total_teams: standing?.totalTeams ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_id,league' })
    }

    // 6. Upsert matches for target date
    const fixtureRows = dayMatches.map((m: {
      id: number
      homeTeam: { name: string }
      awayTeam: { name: string }
      competition: { code: string; name: string }
      utcDate: string
    }) => ({
      fixture_id: m.id,
      home_team: m.homeTeam.name,
      away_team: m.awayTeam.name,
      league: COMPETITION_MAP[m.competition.code] ?? m.competition.name,
      kickoff_time: m.utcDate,
      status: 'scheduled',
      home_odds: null,
      draw_odds: null,
      away_odds: null,
    }))

    const { error: matchErr } = await supabase
      .from('matches')
      .upsert(fixtureRows, { onConflict: 'fixture_id' })
    if (matchErr) throw matchErr

    // 7. Trigger analyze-matches (fire & forget)
    fetch(ANALYZE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date: targetDate }),
    })

    return new Response(
      JSON.stringify({ ok: true, date: targetDate, fixtures: fixtureRows.length }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const errorText = String(err)
    await notifyOps(`🛑 fetch-fixtures crashed entirely\n${errorText}`)
    return new Response(JSON.stringify({ error: errorText }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
