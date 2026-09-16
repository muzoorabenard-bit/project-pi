import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Same dedicated ops bot as fetch-fixtures/analyze-matches/settle-results —
// see settle-results/index.ts for why this is a distinct pair from
// TELEGRAM_BOT_TOKEN/CHAT_ID (project-lydia's own, unrelated bot).
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

// Every real "why didn't picks/bets happen" incident so far (missing cron
// after the DB rebuild, a cron left pointing at the old dead project, a
// hardcoded dry_run, a 3-month-silent Anthropic billing stall, today's
// Supabase pg_net outage) was discovered only because someone eventually
// asked "why didn't this run?" — never because anything alerted on it. This
// function is the fix: it runs once daily, well after fetch-fixtures (5:00
// UTC) and analyze-matches (chained immediately after, or 5:05 UTC as a
// backup) should have completed, and pages Telegram the same day if either
// one hasn't produced a heartbeat recently — instead of the failure sitting
// silent until a human notices days later.
//
// 26h threshold (not 24h): gives one full extra cron cycle of slack for a
// function that's merely running a bit late (e.g. mid-outage, like
// 2026-09-16's Supabase pg_net flakiness) before treating it as broken.
const STALE_THRESHOLD_HOURS = 26
const MONITORED_FUNCTIONS = ['fetch-fixtures', 'analyze-matches']

Deno.serve(async () => {
  try {
    const { data: heartbeats, error } = await supabase
      .from('pipeline_heartbeats')
      .select('function_name, last_run_at, ok, detail')
      .in('function_name', MONITORED_FUNCTIONS)

    if (error) throw error

    const byName = new Map((heartbeats ?? []).map((h) => [h.function_name, h]))
    const problems: string[] = []
    const now = Date.now()

    for (const name of MONITORED_FUNCTIONS) {
      const hb = byName.get(name)
      if (!hb) {
        problems.push(`${name}: no heartbeat ever recorded`)
        continue
      }
      const ageHours = (now - new Date(hb.last_run_at).getTime()) / (1000 * 60 * 60)
      if (ageHours > STALE_THRESHOLD_HOURS) {
        problems.push(`${name}: last ran ${ageHours.toFixed(1)}h ago (${hb.detail ?? 'no detail'})`)
      } else if (!hb.ok) {
        problems.push(`${name}: last run failed ${ageHours.toFixed(1)}h ago — ${hb.detail ?? 'no detail'}`)
      }
    }

    if (problems.length > 0) {
      await notifyOps(
        `🛑 Pipeline healthcheck: picks may not be generating\n\n${problems.join('\n')}\n\n` +
          `This means today's picks likely haven't run — check Supabase function logs / cron.job_run_details.`,
      )
    }

    return new Response(JSON.stringify({ ok: true, problems }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const errorText = String(err)
    await notifyOps(`🛑 pipeline-healthcheck itself crashed\n${errorText}`)
    return new Response(JSON.stringify({ error: errorText }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
