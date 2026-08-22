import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.36.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
// Dedicated bot for all project-pi/ai-bet-ug Telegram traffic (Daily Picks,
// ops alerts). Deliberately NOT TELEGRAM_BOT_TOKEN/CHAT_ID — those belong to
// project-lydia's own, unrelated bot on this shared Supabase project; see
// settle-results/index.ts for the incident that established this rule.
const AI_BET_TELEGRAM_BOT_TOKEN = Deno.env.get('AI_BET_TELEGRAM_BOT_TOKEN')
const AI_BET_TELEGRAM_CHAT_ID = Deno.env.get('AI_BET_TELEGRAM_CHAT_ID')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// Best-effort — an alerting failure must never be why the run itself fails.
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

// Credit/billing exhaustion is a real, previously-seen failure mode — it
// silently stalled this exact function for ~3 months (2026-05-11 to
// 2026-08-15) before anyone noticed. Flag it distinctly so it's obvious
// what to check first.
function looksLikeBillingFailure(errorText: string): boolean {
  return /credit balance|insufficient_quota|billing|429/i.test(errorText)
}

interface TeamStats {
  form: string
  goals_scored_avg: number
  goals_conceded_avg: number
  btts_rate: number
  over25_rate: number
  clean_sheets_last10: number | null
  home_wins_last6: number | null
  home_draws_last6: number | null
  home_losses_last6: number | null
  home_unbeaten_streak: number | null
  home_goals_scored_avg: number | null
  home_goals_conceded_avg: number | null
  away_wins_last6: number | null
  away_goals_scored_avg: number | null
  away_goals_conceded_avg: number | null
  league_position: number | null
  league_points: number | null
  gap_to_relegation: number | null
  gap_to_top4: number | null
  total_teams: number | null
}

// ── Poisson ───────────────────────────────────────────────────────────────────
function poisson(lambda: number, k: number): number {
  let p = Math.exp(-lambda)
  for (let i = 1; i <= k; i++) p *= lambda / i
  return p
}

function matchProbabilities(homeXG: number, awayXG: number) {
  let pHome = 0, pDraw = 0, pAway = 0
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = poisson(homeXG, h) * poisson(awayXG, a)
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
    }
  }
  return { pHome, pDraw, pAway }
}

function xg(attAvg: number, defAvg: number, leagueAvg = 1.4): number {
  return (attAvg * defAvg) / leagueAvg
}

// ── Match narrative ───────────────────────────────────────────────────────────
function classifyMotivation(stats: TeamStats): string {
  const gap = stats.gap_to_relegation
  const top4 = stats.gap_to_top4
  if (gap !== null && gap <= 6) return 'RELEGATION_FIGHT'
  if (top4 !== null && top4 <= 0) return 'TITLE_OR_UCL'
  if (top4 !== null && top4 <= 4) return 'UCL_PUSH'
  if (gap !== null && gap > 15) return 'ON_THE_BEACH'
  return 'MID_TABLE'
}

// ── Draw trap signals ─────────────────────────────────────────────────────────
function drawTrapFlags(homeStats: TeamStats): string[] {
  const flags: string[] = []
  if ((homeStats.home_wins_last6 ?? 0) >= 4) flags.push('HOME_WON_4+_OF_LAST_6_HOME')
  if ((homeStats.gap_to_relegation ?? 99) <= 6) flags.push('HOME_RELEGATION_DESPERATION')
  if ((homeStats.home_unbeaten_streak ?? 0) >= 10) flags.push('HOME_FORTRESS_10+_UNBEATEN')
  return flags
}

// ── Bet type tier classifier ──────────────────────────────────────────────────
function classifyBetType(
  pHome: number,
  pAway: number,
  drawTrapFlagCount: number,
): { eligible1x2: boolean; suggestedType: string; favoredSide: 'home' | 'away' } {
  const pFav = Math.max(pHome, pAway)
  const favoredSide: 'home' | 'away' = pHome >= pAway ? 'home' : 'away'
  if (pFav >= 0.60) return { eligible1x2: true, suggestedType: 'win', favoredSide }
  if (pFav >= 0.50 && drawTrapFlagCount >= 1) return { eligible1x2: true, suggestedType: 'draw_no_bet', favoredSide }
  if (pFav >= 0.50) return { eligible1x2: true, suggestedType: 'double_chance', favoredSide }
  return { eligible1x2: false, suggestedType: 'non_1x2_only', favoredSide }
}

// ── ai-bet-ug bridge ──────────────────────────────────────────────────────────
// Maps a Claude pick onto ai-bet-ug's recommended_bets market/selection
// vocabulary, which mirrors what's actually clickable on BetPawa's match
// page. Returns null for any bet_type without a confirmed BetPawa mapping —
// those still land in `recommendations` as before, they just don't get
// bridged into the auto-placement pipeline.
// draw_no_bet reinstated 2026-08-22 — confirmed via live recon that BetPawa
// offers "Draw No Bet | Full Time" (labels "1"/"2", same numeric convention
// as 1X2). modelProb here is P(win | not a draw) — Kelly needs the
// probability conditional on the bet actually resolving, since a draw
// voids/refunds rather than losing (see settle-results' determineOutcomeForBet).
function mapToBetPawaMarket(
  betType: string,
  pick: string,
  probs: { pHome: number; pDraw: number; pAway: number; pBTTS: number; pOver25: number },
): { market: string; selection: string; modelProb: number } | null {
  switch (betType) {
    case 'win':
      return pick === 'home_win'
        ? { market: '1X2', selection: 'Home', modelProb: probs.pHome }
        : { market: '1X2', selection: 'Away', modelProb: probs.pAway }
    case 'draw_no_bet': {
      const pNotDraw = probs.pHome + probs.pAway
      return pick === 'home_dnb'
        ? { market: 'Draw No Bet', selection: 'Home', modelProb: pNotDraw > 0 ? probs.pHome / pNotDraw : 0.5 }
        : { market: 'Draw No Bet', selection: 'Away', modelProb: pNotDraw > 0 ? probs.pAway / pNotDraw : 0.5 }
    }
    case 'double_chance':
      return pick === 'home_or_draw'
        ? { market: 'Double Chance', selection: '1X', modelProb: probs.pHome + probs.pDraw }
        : { market: 'Double Chance', selection: 'X2', modelProb: probs.pDraw + probs.pAway }
    case 'btts':
      return pick === 'btts_yes'
        ? { market: 'BTTS', selection: 'Yes', modelProb: probs.pBTTS }
        : { market: 'BTTS', selection: 'No', modelProb: 1 - probs.pBTTS }
    case 'over_2.5':
      return { market: 'Over/Under 2.5', selection: 'Over 2.5', modelProb: probs.pOver25 }
    case 'under_2.5':
      return { market: 'Over/Under 2.5', selection: 'Under 2.5', modelProb: 1 - probs.pOver25 }
    default:
      return null
  }
}

function stakeForConfidence(confidence: string): number {
  if (confidence === 'High') return 3
  if (confidence === 'Medium') return 2
  return 1
}

// ── Pressure model (goals-approximated) ──────────────────────────────────────
const PRESSURE_TABLE = [
  { pressure: 24, overs: 42.2, unders: 57.8 },
  { pressure: 28, overs: 42.9, unders: 57.1 },
  { pressure: 32, overs: 43.6, unders: 56.4 },
  { pressure: 36, overs: 44.2, unders: 55.8 },
  { pressure: 40, overs: 44.9, unders: 55.1 },
  { pressure: 44, overs: 45.6, unders: 54.4 },
  { pressure: 48, overs: 46.3, unders: 53.7 },
]

function pressureModel(homeStats: TeamStats, awayStats: TeamStats) {
  const homeAtt = (homeStats.home_goals_scored_avg ?? homeStats.goals_scored_avg) * 11.4
  const homeDef = (awayStats.away_goals_conceded_avg ?? awayStats.goals_conceded_avg) * 12
  const awayAtt = (awayStats.away_goals_scored_avg ?? awayStats.goals_scored_avg) * 11.4
  const awayDef = (homeStats.home_goals_conceded_avg ?? homeStats.goals_conceded_avg) * 12
  const expectedHome = (homeAtt + awayDef) / 2
  const expectedAway = (awayAtt + homeDef) / 2
  const total = +(expectedHome + expectedAway).toFixed(1)

  // Find nearest bin in table
  const nearest = PRESSURE_TABLE.reduce((prev, curr) =>
    Math.abs(curr.pressure - total) < Math.abs(prev.pressure - total) ? curr : prev,
  )
  return { total, pOvers: nearest.overs, pUnders: nearest.unders }
}

// ── Claude analysis ───────────────────────────────────────────────────────────
async function claudeAnalysis(payload: {
  home_team: string
  away_team: string
  league: string
  homeStats: TeamStats
  awayStats: TeamStats
  probs: { pHome: number; pDraw: number; pAway: number; pBTTS: number; pOver25: number }
  pressure: { total: number; pOvers: number; pUnders: number }
  drawFlags: string[]
  homeMotivation: string
  awayMotivation: string
  odds: { home: number | null; draw: number | null; away: number | null }
  betGuidance: { eligible1x2: boolean; suggestedType: string; favoredSide: 'home' | 'away' }
}): Promise<{ bet_type: string; pick: string; confidence: string; reasoning: string }> {
  const h = payload.homeStats
  const a = payload.awayStats

  const prompt = `You are an expert soccer betting analyst. Use ALL the signals below to recommend the single best bet for this match.

MATCH: ${payload.home_team} vs ${payload.away_team} (${payload.league})

═══ MATCH NARRATIVE ═══
Home (${payload.home_team}): ${payload.homeMotivation} | Pos ${h.league_position ?? '?'}, ${h.league_points ?? '?'} pts, ${h.gap_to_relegation !== null ? h.gap_to_relegation + ' pts above relegation' : 'standing unknown'}
Away (${payload.away_team}): ${payload.awayMotivation} | Pos ${a.league_position ?? '?'}, ${a.league_points ?? '?'} pts, ${a.gap_to_relegation !== null ? a.gap_to_relegation + ' pts above relegation' : 'standing unknown'}

═══ DRAW TRAP SIGNALS (active = draw unlikely) ═══
${payload.drawFlags.length > 0 ? payload.drawFlags.join(', ') : 'None active'}

═══ HOME FORM (last 6 home games) ═══
W${h.home_wins_last6 ?? '?'} D${h.home_draws_last6 ?? '?'} L${h.home_losses_last6 ?? '?'} | Unbeaten streak: ${h.home_unbeaten_streak ?? '?'} games
Avg at home: ${h.home_goals_scored_avg ?? h.goals_scored_avg} scored / ${h.home_goals_conceded_avg ?? h.goals_conceded_avg} conceded

═══ AWAY RELIABILITY (last 6 away games) ═══
Away wins: ${a.away_wins_last6 ?? '?'}${(a.away_wins_last6 ?? 2) <= 1 ? ' ⚠️ CANNOT WIN AWAY' : ''}
Avg away: ${a.away_goals_scored_avg ?? a.goals_scored_avg} scored / ${a.away_goals_conceded_avg ?? a.goals_conceded_avg} conceded

═══ CLEAN SHEET STREAKS (last 10 games) ═══
${payload.home_team}: ${h.clean_sheets_last10 ?? '?'} clean sheets | ${payload.away_team}: ${a.clean_sheets_last10 ?? '?'} clean sheets
${(h.clean_sheets_last10 ?? 0) >= 4 || (a.clean_sheets_last10 ?? 0) >= 4 ? '⚠️ One or both teams on a clean sheet run — BTTS less likely' : ''}

═══ OVERALL FORM (last 5) ═══
${payload.home_team}: ${h.form} | ${payload.away_team}: ${a.form}

═══ POISSON MODEL ═══
P(Home Win): ${(payload.probs.pHome * 100).toFixed(1)}% | P(Draw): ${(payload.probs.pDraw * 100).toFixed(1)}% | P(Away Win): ${(payload.probs.pAway * 100).toFixed(1)}%
P(BTTS Yes): ${(payload.probs.pBTTS * 100).toFixed(1)}% | P(Over 2.5): ${(payload.probs.pOver25 * 100).toFixed(1)}%

═══ PRESSURE MODEL (goals-approximated — no shots data available) ═══
Total pressure index: ${payload.pressure.total}
P(Over 2.5): ${payload.pressure.pOvers}% | P(Under 2.5): ${payload.pressure.pUnders}%

═══ SMART MONEY (bookmaker odds) ═══
Home: ${payload.odds.home ?? 'N/A'} | Draw: ${payload.odds.draw ?? 'N/A'} | Away: ${payload.odds.away ?? 'N/A'}

═══ BET TYPE GUIDANCE ═══
Eligible 1X2 market: ${payload.betGuidance.eligible1x2 ? 'YES' : 'NO — must pick btts, over_2.5, or under_2.5'}
Suggested type: ${payload.betGuidance.suggestedType}
Favored side: ${payload.betGuidance.favoredSide}

RULES YOU MUST FOLLOW:
- eligible 1X2 = NO → bet_type must be "btts", "over_2.5", or "under_2.5"
- suggested "win" → bet_type: "win", pick: "${payload.betGuidance.favoredSide}_win"
- suggested "draw_no_bet" → bet_type: "draw_no_bet", pick: "${payload.betGuidance.favoredSide}_dnb"
- suggested "double_chance" → bet_type: "double_chance", pick: "${payload.betGuidance.favoredSide}_or_draw"
- For BTTS: bet_type: "btts", pick: "btts_yes" or "btts_no"
- For totals: bet_type: "over_2.5" or "under_2.5", pick same as bet_type
- You may deviate from the suggested type if reasoning clearly supports it, but you MUST use the allowed values

INSTRUCTIONS:
1. Start with match narrative — what's at stake changes everything
2. Check draw trap signals — if active, lean away from Draw picks
3. Check away team reliability — if ≤1 away win in 6, they are unlikely to win here
4. Use pressure + Poisson models together for over/under
5. Clean sheet streaks reduce BTTS likelihood
6. Smart money (low odds) often reflects informed market view

Respond with ONLY valid JSON (no markdown):
{
  "bet_type": "win" | "draw_no_bet" | "double_chance" | "btts" | "over_2.5" | "under_2.5",
  "pick": "home_win" | "away_win" | "home_dnb" | "away_dnb" | "home_or_draw" | "away_or_draw" | "btts_yes" | "btts_no" | "over_2.5" | "under_2.5",
  "confidence": "High" | "Medium" | "Low",
  "reasoning": "3-4 sentences referencing the key signals that drove this pick."
}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    // 500 was too small once thinking tokens are accounted for — one match
    // burned the entire budget on an empty "thinking" block and never
    // reached the actual JSON answer (stop_reason: max_tokens, no text
    // block at all). 2000 leaves headroom for thinking + the ~500-token
    // JSON response.
    max_tokens: 2000,
    // Explicitly disabled: this call wants a single structured JSON answer,
    // not visible chain-of-thought, and one match's request was observed
    // ending its turn with only an empty "thinking" block and no text
    // content at all — disabling removes that failure mode entirely rather
    // than working around it.
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt }],
  })

  const block = message.content[0] as { type: string; text?: string } | undefined
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error(
      `unexpected Claude response shape: stop_reason=${message.stop_reason}, ` +
      `content=${JSON.stringify(message.content).slice(0, 500)}`,
    )
  }

  const raw = block.text.trim()
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`Claude returned invalid JSON (${String(err)}): ${text.slice(0, 800)}`)
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────
const PICK_LABELS: Record<string, string> = {
  home_win: 'Home Win',
  away_win: 'Away Win',
  home_dnb: 'Draw No Bet (Home)',
  away_dnb: 'Draw No Bet (Away)',
  home_or_draw: 'Double Chance (Home or Draw)',
  away_or_draw: 'Double Chance (Away or Draw)',
  btts_yes: 'BTTS Yes',
  btts_no: 'BTTS No',
  'over_2.5': 'Over 2.5 Goals',
  'under_2.5': 'Under 2.5 Goals',
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatOnePick(
  r: { home: string; away: string; league: string; bet_type: string; pick: string; confidence: string; reasoning: string; kickoff: string; motivation: string },
  index: number,
  total: number,
): string {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const time = new Date(r.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  const conf = r.confidence === 'High' ? '🟢' : r.confidence === 'Medium' ? '🟡' : '🔴'
  const motiv = r.motivation !== 'MID_TABLE' ? ` <i>(${r.motivation.replace(/_/g, ' ')})</i>` : ''
  const pickLabel = PICK_LABELS[r.pick] ?? r.pick
  let msg = `⚽ <b>Project Pi — Daily Picks</b>  [${index}/${total}]\n📅 ${date}\n\n`
  msg += `${conf} <b>${esc(r.home)} vs ${esc(r.away)}</b>${motiv}\n`
  msg += `🏆 ${esc(r.league)}  ⏰ ${time} UTC\n`
  msg += `🎯 Pick: <b>${esc(pickLabel)}</b> (${r.confidence})\n`
  msg += `💬 ${esc(r.reasoning)}\n\n`
  msg += `<i>Bet responsibly.</i>`
  return msg
}

async function sendTelegram(text: string) {
  // As of 2026-08-17: moved onto the dedicated AI Bet UG Alerts bot,
  // same as ops alerts/settlement. Previously used TELEGRAM_BOT_TOKEN/
  // TELEGRAM_CHAT_ID — project-lydia's shared bot — which was never meant
  // to carry Daily Picks traffic; that was a leftover from before this
  // project had its own bot.
  const res = await fetch(`https://api.telegram.org/bot${AI_BET_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: AI_BET_TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Telegram error ${res.status}: ${err}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}))
    const date: string = body.date ?? new Date().toISOString().slice(0, 10)

    const dayStart = new Date(date + 'T00:00:00Z').toISOString()
    const dayEnd   = new Date(date + 'T23:59:59Z').toISOString()

    const { data: matches, error: mErr } = await supabase
      .from('matches')
      .select('id, home_team, away_team, league, kickoff_time, home_odds, draw_odds, away_odds')
      .gte('kickoff_time', dayStart)
      .lte('kickoff_time', dayEnd)
      .eq('status', 'scheduled')

    if (mErr) throw mErr
    if (!matches?.length) {
      return new Response(JSON.stringify({ ok: true, message: 'No fixtures to analyze' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Filter already-recommended matches. Deliberately NOT scoped by a
    // created_at date range: `dayStart`/`dayEnd` bound the matches'
    // *kickoff* date, but analysis can run well before that (fetch-fixtures
    // looks 8 days ahead), so a recommendation's insertion timestamp can
    // legitimately fall on an earlier calendar day than the fixture it's
    // for. match_id already uniquely identifies the fixture — a match
    // should never be re-analyzed once it has any recommendation at all.
    const matchIds = matches.map((m: { id: string }) => m.id)
    const { data: existing } = await supabase
      .from('recommendations')
      .select('match_id')
      .in('match_id', matchIds)
    const alreadyDone = new Set((existing ?? []).map((r: { match_id: string }) => r.match_id))
    const toAnalyze = matches.filter((m: { id: string }) => !alreadyDone.has(m.id))

    const telegramRecs: { home: string; away: string; league: string; bet_type: string; pick: string; confidence: string; reasoning: string; kickoff: string; motivation: string }[] = []

    const defaultStats: TeamStats = {
      form: '?????', goals_scored_avg: 1.4, goals_conceded_avg: 1.4,
      btts_rate: 0.5, over25_rate: 0.5, clean_sheets_last10: null,
      home_wins_last6: null, home_draws_last6: null, home_losses_last6: null,
      home_unbeaten_streak: null, home_goals_scored_avg: null, home_goals_conceded_avg: null,
      away_wins_last6: null, away_goals_scored_avg: null, away_goals_conceded_avg: null,
      league_position: null, league_points: null, gap_to_relegation: null,
      gap_to_top4: null, total_teams: null,
    }

    const failures: { match: string; error: string }[] = []

    for (const match of toAnalyze) {
      // One match's failure (most commonly Claude returning malformed JSON —
      // it's free-form text parsing, not a schema-constrained tool call, so
      // occasional bad output is expected) must not abort the whole batch —
      // every other match in `toAnalyze` should still get a shot.
      try {
        const { data: stats } = await supabase
          .from('team_stats')
          .select('*')
          .in('team_name', [match.home_team, match.away_team])

        const homeStats: TeamStats = stats?.find((s: { team_name: string }) => s.team_name === match.home_team) ?? defaultStats
        const awayStats: TeamStats = stats?.find((s: { team_name: string }) => s.team_name === match.away_team) ?? defaultStats

        // Poisson model
        const homeXG = xg(homeStats.goals_scored_avg, awayStats.goals_conceded_avg)
        const awayXG = xg(awayStats.goals_scored_avg, homeStats.goals_conceded_avg)
        const { pHome, pDraw, pAway } = matchProbabilities(homeXG, awayXG)
        const pBTTS = Math.sqrt(homeStats.btts_rate * awayStats.btts_rate)
        const pOver25 = (homeStats.over25_rate + awayStats.over25_rate) / 2

        // Strategy signals
        const homeMotivation = classifyMotivation(homeStats)
        const awayMotivation = classifyMotivation(awayStats)
        const drawFlags = drawTrapFlags(homeStats)
        const pressure = pressureModel(homeStats, awayStats)
        const betGuidance = classifyBetType(pHome, pAway, drawFlags.length)

        const claudeResult = await claudeAnalysis({
          home_team: match.home_team,
          away_team: match.away_team,
          league: match.league,
          homeStats,
          awayStats,
          probs: { pHome, pDraw, pAway, pBTTS, pOver25 },
          pressure,
          drawFlags,
          homeMotivation,
          awayMotivation,
          odds: { home: match.home_odds, draw: match.draw_odds, away: match.away_odds },
          betGuidance,
        })

        await supabase.from('recommendations').insert({
          match_id: match.id,
          bet_type: claudeResult.bet_type,
          pick: claudeResult.pick,
          confidence: claudeResult.confidence,
          reasoning: claudeResult.reasoning,
          stat_summary: {
            homeXG, awayXG, pHome, pDraw, pAway, pBTTS, pOver25,
            pressure, drawFlags, homeMotivation, awayMotivation,
          },
        })

        // Bridge into ai-bet-ug's recommended_bets (same Supabase project).
        // bookmaker_event_url is left null here — resolving it needs a real
        // browser (BetPawa has no public API), which can't run in a Deno edge
        // function; ai-bet-ug's src/cli/resolveEvents.ts fills it in locally.
        // Nothing here is auto-actionable: a human still has to flip
        // status from pending_review to approved before ai-bet-ug's runner
        // will ever touch it, independent of auto_execute/dry_run.
        const mapped = mapToBetPawaMarket(claudeResult.bet_type, claudeResult.pick, {
          pHome, pDraw, pAway, pBTTS, pOver25,
        })
        if (mapped) {
          await supabase.from('recommended_bets').insert({
            league: match.league,
            home_team: match.home_team,
            away_team: match.away_team,
            kickoff_at: match.kickoff_time,
            market: mapped.market,
            selection: mapped.selection,
            model_odds: mapped.modelProb > 0 ? +(1 / mapped.modelProb).toFixed(2) : null,
            model_probability: mapped.modelProb,
            bookmaker_odds: null,
            edge_pct: null,
            recommended_stake: stakeForConfidence(claudeResult.confidence),
            auto_execute: true,
            dry_run: true,
            source: 'project-pi',
            status: 'pending_review',
            bookmaker_event_url: null,
            // Links back to this match row so settle-results can find the
            // real final score without fuzzy team-name/date matching.
            pi_match_id: match.id,
          })
        }

        telegramRecs.push({
          home: match.home_team,
          away: match.away_team,
          league: match.league,
          bet_type: claudeResult.bet_type,
          pick: claudeResult.pick,
          confidence: claudeResult.confidence,
          reasoning: claudeResult.reasoning,
          kickoff: match.kickoff_time,
          motivation: homeMotivation,
        })
      } catch (err) {
        failures.push({ match: `${match.home_team} v ${match.away_team}`, error: String(err) })
      }
    }

    for (let i = 0; i < telegramRecs.length; i++) {
      await sendTelegram(formatOnePick(telegramRecs[i], i + 1, telegramRecs.length))
    }

    if (failures.length > 0) {
      const sample = failures.slice(0, 3).map((f) => `${f.match}: ${f.error}`).join('\n')
      const billingSuspected = failures.some((f) => looksLikeBillingFailure(f.error))
      await notifyOps(
        `${billingSuspected ? '💰 Possible Anthropic credit/billing issue' : '⚠️'} analyze-matches: ${failures.length}/${toAnalyze.length} matches failed\n\n${sample}` +
          (failures.length > 3 ? `\n...and ${failures.length - 3} more` : ''),
      )
    }

    return new Response(
      JSON.stringify({ ok: true, analyzed: telegramRecs.length, failures }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const errorText = String(err)
    await notifyOps(
      `${looksLikeBillingFailure(errorText) ? '💰 Possible Anthropic credit/billing issue' : '🛑'} analyze-matches crashed entirely\n${errorText}`,
    )
    return new Response(JSON.stringify({ error: errorText }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
