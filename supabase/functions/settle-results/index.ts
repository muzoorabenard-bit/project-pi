import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FOOTBALL_DATA_KEY = Deno.env.get('FOOTBALL_DATA_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Dedicated bot for ai-bet-ug/project-pi betting notifications only.
// Deliberately NOT named TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID — this Supabase
// project is shared with project-lydia (telegram-webhook, sms-ingest,
// lydia-meeting), which already owns those names for its own, unrelated
// Telegram bot. Reusing them once already silently redirected/broke Lydia's
// bot on 2026-08-16 — this is the fix. Optional: silently no-ops if unset,
// same reasoning as ai-bet-ug's notify/telegram.ts — a settlement
// notification must never be why settlement itself fails.
const AI_BET_TELEGRAM_BOT_TOKEN = Deno.env.get('AI_BET_TELEGRAM_BOT_TOKEN')
const AI_BET_TELEGRAM_CHAT_ID = Deno.env.get('AI_BET_TELEGRAM_CHAT_ID')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function notifyTelegram(text: string): Promise<void> {
  if (!AI_BET_TELEGRAM_BOT_TOKEN || !AI_BET_TELEGRAM_CHAT_ID) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${AI_BET_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: AI_BET_TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) console.error(`telegram notification failed: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error(`telegram notification threw: ${err}`)
  }
}

const COMPETITION_CODES = ['PL', 'PD', 'BL1', 'SA', 'FL1']
const RESOLVED_STATUSES = ['finished', 'postponed', 'cancelled']

// Retries transport-level failures (connection reset, closed before
// complete) with a short backoff — same pattern as fetch-fixtures'
// identical helper, after the same class of transient error was seen live
// against both functions on 2026-08-17. Does NOT retry a real HTTP error
// response (4xx/5xx) — those are unlikely to be fixed by trying again.
// deno-lint-ignore no-explicit-any
async function fd(endpoint: string): Promise<any> {
  const attempts = 3
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`https://api.football-data.org/v4/${endpoint}`, {
        headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY },
      })
      if (!res.ok) throw new Error(`football-data.org ${res.status}: ${await res.text()}`)
      return await res.json()
    } catch (err) {
      if (attempt === attempts) throw err
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }
}

// ── Outcome logic ──────────────────────────────────────────────────────────
// H/A = final home/away goals. Draw No Bet (reinstated 2026-08-22) is the
// one genuine void/push case in ai-bet-ug's market vocabulary — a draw
// refunds the stake rather than winning or losing. Every other market here
// has no void case (2.5 lines can't push).
function determineOutcomeForBet(market: string, selection: string, h: number, a: number): 'win' | 'loss' | 'void' {
  switch (market) {
    case '1X2':
      if (selection === 'Home') return h > a ? 'win' : 'loss'
      if (selection === 'Draw') return h === a ? 'win' : 'loss'
      if (selection === 'Away') return a > h ? 'win' : 'loss'
      break
    case 'Double Chance':
      if (selection === '1X') return h >= a ? 'win' : 'loss'
      if (selection === 'X2') return a >= h ? 'win' : 'loss'
      if (selection === '12') return h !== a ? 'win' : 'loss'
      break
    case 'BTTS':
      if (selection === 'Yes') return h > 0 && a > 0 ? 'win' : 'loss'
      if (selection === 'No') return h === 0 || a === 0 ? 'win' : 'loss'
      break
    case 'Over/Under 2.5':
      if (selection === 'Over 2.5') return h + a >= 3 ? 'win' : 'loss'
      if (selection === 'Under 2.5') return h + a <= 2 ? 'win' : 'loss'
      break
    case 'Draw No Bet':
      if (h === a) return 'void'
      if (selection === 'Home') return h > a ? 'win' : 'loss'
      if (selection === 'Away') return a > h ? 'win' : 'loss'
      break
  }
  throw new Error(`cannot determine outcome for market='${market}' selection='${selection}'`)
}

// project-pi's fuller vocabulary (recommendations.result) — additionally
// covers draw_no_bet, the one genuine push/void case in the whole system.
function determineOutcomeForRecommendation(
  betType: string,
  pick: string,
  h: number,
  a: number,
): 'Win' | 'Loss' | 'Void' {
  switch (betType) {
    case 'win':
      if (pick === 'home_win') return h > a ? 'Win' : 'Loss'
      if (pick === 'away_win') return a > h ? 'Win' : 'Loss'
      break
    case 'draw_no_bet':
      if (h === a) return 'Void'
      if (pick === 'home_dnb') return h > a ? 'Win' : 'Loss'
      if (pick === 'away_dnb') return a > h ? 'Win' : 'Loss'
      break
    case 'double_chance':
      if (pick === 'home_or_draw') return h >= a ? 'Win' : 'Loss'
      if (pick === 'away_or_draw') return a >= h ? 'Win' : 'Loss'
      break
    case 'btts':
      if (pick === 'btts_yes') return h > 0 && a > 0 ? 'Win' : 'Loss'
      if (pick === 'btts_no') return h === 0 || a === 0 ? 'Win' : 'Loss'
      break
    case 'over_2.5':
      return h + a >= 3 ? 'Win' : 'Loss'
    case 'under_2.5':
      return h + a <= 2 ? 'Win' : 'Loss'
  }
  throw new Error(`cannot determine outcome for bet_type='${betType}' pick='${pick}'`)
}

interface MatchRow {
  id: string
  fixture_id: number
  status: string
  home_score: number | null
  away_score: number | null
}

// ── Phase 1: fetch real results (batched) ───────────────────────────────────
async function fetchAndUpdateResults(): Promise<{ updated: number; failures: { fixtureId: number; error: string }[] }> {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const windowStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

  const { data: pending, error } = await supabase
    .from('matches')
    .select('id, fixture_id, kickoff_time')
    .eq('status', 'scheduled')
    .lt('kickoff_time', cutoff)
    .gt('kickoff_time', windowStart)

  if (error) throw error
  if (!pending?.length) return { updated: 0, failures: [] }

  const dates = pending.map((m: { kickoff_time: string }) => m.kickoff_time.slice(0, 10)).sort()
  const dateFrom = dates[0]
  const dateTo = new Date().toISOString().slice(0, 10)
  const codes = COMPETITION_CODES.join(',')

  // This single batched call is the one part of phase 1 not already inside
  // the per-match try/catch below — a transient network failure here (seen
  // 2026-08-17: "connection closed before message completed") used to
  // propagate all the way up and crash phases 2 and 3 too, instead of just
  // costing this one hourly run. Contained here so a football-data.org
  // hiccup only ever costs phase 1 — phases 2/3 (settling recommendations
  // and real-money bet_placements) still run normally against whatever
  // match data already exists from previous successful runs.
  // deno-lint-ignore no-explicit-any
  let response: { matches?: any[] }
  try {
    response = await fd(`matches?dateFrom=${dateFrom}&dateTo=${dateTo}&competitions=${codes}`)
  } catch (err) {
    return { updated: 0, failures: [{ fixtureId: -1, error: `batched fetch failed: ${err}` }] }
  }
  const byFixtureId = new Map<number, { status: string; score: { fullTime: { home: number | null; away: number | null } } }>(
    (response.matches ?? []).map((m: { id: number; status: string; score: { fullTime: { home: number | null; away: number | null } } }) => [m.id, m]),
  )

  let updated = 0
  const failures: { fixtureId: number; error: string }[] = []

  for (const match of pending) {
    try {
      const remote = byFixtureId.get(match.fixture_id)
      if (!remote) continue // not in the response yet — retried next run

      if (remote.status === 'FINISHED') {
        await supabase
          .from('matches')
          .update({
            status: 'finished',
            home_score: remote.score.fullTime.home,
            away_score: remote.score.fullTime.away,
          })
          .eq('id', match.id)
        updated++
      } else if (remote.status === 'POSTPONED' || remote.status === 'CANCELLED') {
        await supabase
          .from('matches')
          .update({ status: remote.status.toLowerCase() })
          .eq('id', match.id)
        updated++
      }
      // SCHEDULED / TIMED / IN_PLAY / PAUSED / SUSPENDED — leave untouched,
      // naturally retried on the next scheduled run.
    } catch (err) {
      failures.push({ fixtureId: match.fixture_id, error: String(err) })
    }
  }

  return { updated, failures }
}

// ── Phase 2: settle recommendations.result ──────────────────────────────────
// No FK-based embedding here — recommendations.match_id DOES have a real FK,
// but we join explicitly anyway to keep both phases consistent and simple.
async function settleRecommendations(): Promise<{ settled: number; failures: { id: string; error: string }[] }> {
  const { data: pendingRecs, error: recErr } = await supabase
    .from('recommendations')
    .select('id, match_id, bet_type, pick')
    .is('result', null)

  if (recErr) throw recErr
  if (!pendingRecs?.length) return { settled: 0, failures: [] }

  const matchIds = [...new Set(pendingRecs.map((r: { match_id: string }) => r.match_id))]
  const { data: matches, error: matchErr } = await supabase
    .from('matches')
    .select('id, status, home_score, away_score')
    .in('id', matchIds)
    .in('status', RESOLVED_STATUSES)

  if (matchErr) throw matchErr
  const matchById = new Map<string, { status: string; home_score: number | null; away_score: number | null }>(
    (matches ?? []).map((m: { id: string; status: string; home_score: number | null; away_score: number | null }) => [
      m.id,
      m,
    ]),
  )

  let settled = 0
  const failures: { id: string; error: string }[] = []

  for (const rec of pendingRecs) {
    const match = matchById.get(rec.match_id)
    if (!match) continue // this match isn't resolved yet — retried next run

    try {
      const result =
        match.status !== 'finished'
          ? 'Void'
          : determineOutcomeForRecommendation(rec.bet_type, rec.pick, match.home_score!, match.away_score!)

      await supabase.from('recommendations').update({ result }).eq('id', rec.id)
      settled++
    } catch (err) {
      failures.push({ id: rec.id, error: String(err) })
    }
  }

  return { settled, failures }
}

// ── Phase 3: settle bet_placements + bankroll (real money) ─────────────────
async function settleBetPlacements(): Promise<{ settled: number; failures: { id: number; error: string }[] }> {
  const { data: pendingPlacements, error: placementErr } = await supabase
    .from('bet_placements')
    .select('id, recommended_bet_id, stake_placed, submitted_odds')
    .eq('status', 'success')
    .is('result', null)

  if (placementErr) throw placementErr
  if (!pendingPlacements?.length) return { settled: 0, failures: [] }

  const recBetIds = [...new Set(pendingPlacements.map((p: { recommended_bet_id: number }) => p.recommended_bet_id))]
  const { data: recBets, error: recBetErr } = await supabase
    .from('recommended_bets')
    .select('id, market, selection, pi_match_id, home_team, away_team, league')
    .in('id', recBetIds)
    .not('pi_match_id', 'is', null)

  if (recBetErr) throw recBetErr
  type RecBetRow = { id: number; market: string; selection: string; pi_match_id: string; home_team: string; away_team: string; league: string }
  const recBetById = new Map<number, RecBetRow>(
    (recBets ?? []).map((r: RecBetRow) => [r.id, r]),
  )

  const matchIds = [...new Set([...recBetById.values()].map((r) => r.pi_match_id))]
  const { data: matches, error: matchErr } = await supabase
    .from('matches')
    .select('id, status, home_score, away_score')
    .in('id', matchIds)
    .in('status', RESOLVED_STATUSES)

  if (matchErr) throw matchErr
  const matchById = new Map<string, MatchRow>(
    (matches ?? []).map((m: MatchRow) => [m.id, m]),
  )

  let settled = 0
  const failures: { id: number; error: string }[] = []

  for (const placement of pendingPlacements) {
    const recBet = recBetById.get(placement.recommended_bet_id)
    if (!recBet) continue // no pi_match_id — never resolvable, skip silently
    const match = matchById.get(recBet.pi_match_id)
    if (!match) continue // not resolved yet — retried next run

    try {
      const matchLabel = `${recBet.league}: ${recBet.home_team} vs ${recBet.away_team}`

      if (match.status !== 'finished') {
        await supabase
          .from('bet_placements')
          .update({ result: 'void', payout: placement.stake_placed, settled_at: new Date().toISOString() })
          .eq('id', placement.id)
        const { data: newBalance } = await supabase.rpc('append_bankroll_entry', {
          p_change: placement.stake_placed,
          p_reason: 'settled_void',
          p_bet_placement_id: placement.id,
          p_notes: 'Match postponed/cancelled — stake refunded.',
        })
        await notifyTelegram(
          `↩️ VOID — refunded\n${matchLabel}\n${recBet.market} — ${recBet.selection}\n` +
            `Stake ${placement.stake_placed} refunded. Bankroll: ${newBalance} UGX`,
        )
      } else {
        const result = determineOutcomeForBet(recBet.market, recBet.selection, match.home_score!, match.away_score!)
        // Draw No Bet's genuine push case (a draw) refunds the stake as its
        // "payout"; every other market here only ever wins or loses.
        const payout =
          result === 'win' ? placement.stake_placed * placement.submitted_odds : result === 'void' ? placement.stake_placed : 0

        await supabase
          .from('bet_placements')
          .update({ result, payout, settled_at: new Date().toISOString() })
          .eq('id', placement.id)

        if (result === 'win') {
          const { data: newBalance } = await supabase.rpc('append_bankroll_entry', {
            p_change: payout,
            p_reason: 'settled_win',
            p_bet_placement_id: placement.id,
            p_notes: `${recBet.market}/${recBet.selection} — won.`,
          })
          await notifyTelegram(
            `🎉 WON — ${match.home_score}-${match.away_score}\n${matchLabel}\n${recBet.market} — ${recBet.selection} @ ${placement.submitted_odds}\n` +
              `Stake ${placement.stake_placed} → Payout ${payout}. Bankroll: ${newBalance} UGX`,
          )
        } else if (result === 'void') {
          const { data: newBalance } = await supabase.rpc('append_bankroll_entry', {
            p_change: payout,
            p_reason: 'settled_void',
            p_bet_placement_id: placement.id,
            p_notes: `${recBet.market}/${recBet.selection} — draw, stake refunded.`,
          })
          await notifyTelegram(
            `↩️ VOID (draw) — ${match.home_score}-${match.away_score}\n${matchLabel}\n${recBet.market} — ${recBet.selection}\n` +
              `Stake ${placement.stake_placed} refunded. Bankroll: ${newBalance} UGX`,
          )
        } else {
          // Zero-amount entry: the stake already left the bankroll at
          // placement time. This exists purely to mark the loss for
          // history/audit/future calibration, not to move money again.
          const { data: newBalance } = await supabase.rpc('append_bankroll_entry', {
            p_change: 0,
            p_reason: 'settled_loss',
            p_bet_placement_id: placement.id,
            p_notes: `${recBet.market}/${recBet.selection} — lost.`,
          })
          await notifyTelegram(
            `❌ LOST — ${match.home_score}-${match.away_score}\n${matchLabel}\n${recBet.market} — ${recBet.selection} @ ${placement.submitted_odds}\n` +
              `Stake ${placement.stake_placed} lost. Bankroll: ${newBalance} UGX`,
          )
        }
      }
      settled++
    } catch (err) {
      failures.push({ id: placement.id, error: String(err) })
    }
  }

  return { settled, failures }
}

// ── Main ──────────────────────────────────────────────────────────────────
Deno.serve(async () => {
  try {
    const phase1 = await fetchAndUpdateResults()
    const phase2 = await settleRecommendations()
    const phase3 = await settleBetPlacements()

    const totalFailures = phase1.failures.length + phase2.failures.length + phase3.failures.length
    if (totalFailures > 0) {
      await notifyTelegram(
        `⚠️ settle-results: ${totalFailures} item(s) failed to settle\n` +
          `phase1 (results): ${phase1.failures.length} | phase2 (recommendations): ${phase2.failures.length} | phase3 (bet_placements): ${phase3.failures.length}\n` +
          `Self-heals next hourly run if transient — check logs if it persists.`,
      )
    }

    return new Response(
      JSON.stringify({ ok: true, phase1, phase2, phase3 }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const errorText = String(err)
    await notifyTelegram(`🛑 settle-results crashed entirely\n${errorText}`)
    return new Response(JSON.stringify({ error: errorText }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
