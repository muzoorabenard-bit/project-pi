import { resolveOutcome } from "./resolveOutcome.js";
import { computeModelDiagnostics, type ModelDiagnosticResult } from "./modelDiagnostics.js";
import { computeAgreement, type AgreementRow } from "./agreement.js";
import { computeEdgeBuckets, type EdgeBucketResult } from "./edgeBuckets.js";
import { auditExtremePredictions, type ExtremeAuditEntry } from "./extremeAudit.js";
import { compareAgainstMarketBaseline, type BaselineComparison } from "./baseline.js";
import type { BacktestableRecord, RejectedRecord } from "./historicalSnapshotProvider.js";

export interface GroupPerformance {
  key: string;
  betsCount: number;
  winRate: number | null;
  roi: number | null;
  profit: number;
  sampleWarning: boolean; // true when betsCount is too small to draw a conclusion from (Section 18)
}

const MIN_SAMPLE_FOR_CONCLUSION = 20;

function summarizeByDecidedMarket(records: BacktestableRecord[], keyFn: (r: BacktestableRecord) => string): GroupPerformance[] {
  const groups = new Map<string, BacktestableRecord[]>();
  for (const r of records) {
    if (!r.decision || r.decision.decision !== "VALUE_BET" || !r.decision.predictionMarket || !r.decision.predictionSelection) continue;
    const key = keyFn(r);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([key, groupRecords]) => {
    const priced = groupRecords
      .map((r) => ({ r, prediction: r.predictions.find((p) => p.market === r.decision!.predictionMarket && p.selection === r.decision!.predictionSelection) }))
      .filter((x): x is { r: BacktestableRecord; prediction: NonNullable<(typeof x)["prediction"]> } => x.prediction?.bookmakerOdds != null);

    const decided = priced
      .map(({ r, prediction }) => ({ prediction, outcome: resolveOutcome(r.decision!.predictionMarket!, r.decision!.predictionSelection!, r.homeScore, r.awayScore) }))
      .filter((x) => x.outcome !== "void");

    const wins = decided.filter((x) => x.outcome === "win").length;
    const profit = decided.reduce((sum, x) => sum + (x.outcome === "win" ? x.prediction.bookmakerOdds! - 1 : -1), 0);

    return {
      key,
      betsCount: priced.length,
      winRate: decided.length > 0 ? +(wins / decided.length).toFixed(4) : null,
      roi: priced.length > 0 ? +(profit / priced.length).toFixed(4) : null,
      profit: +profit.toFixed(4),
      sampleWarning: priced.length < MIN_SAMPLE_FOR_CONCLUSION,
    };
  });
}

export type BrokenCategory = "DATA_PROBLEM" | "MODEL_PROBLEM" | "CALIBRATION_PROBLEM" | "ENSEMBLE_PROBLEM" | "ODDS_PROBLEM" | "IMPLEMENTATION_BUG" | "INSUFFICIENT_DATA" | "UNKNOWN";

export interface BrokenFinding {
  category: BrokenCategory;
  finding: string;
}

export interface BacktestReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  fixturesConsidered: number;
  fixturesBacktestable: number;
  fixturesRejected: RejectedRecord[];
  modelCalibration: ModelDiagnosticResult[];
  marketPerformance: GroupPerformance[];
  leaguePerformance: GroupPerformance[];
  edgeBuckets: EdgeBucketResult[];
  extremePredictions: ExtremeAuditEntry[];
  agreement: AgreementRow[];
  marketBaseline: BaselineComparison;
  dataQualityCounts: Record<string, number>;
  findings: BrokenFinding[];
}

function assessFindings(records: BacktestableRecord[], edgeBuckets: EdgeBucketResult[], extreme: ExtremeAuditEntry[]): BrokenFinding[] {
  const findings: BrokenFinding[] = [];

  if (records.length < MIN_SAMPLE_FOR_CONCLUSION) {
    findings.push({
      category: "INSUFFICIENT_DATA",
      finding: `Only ${records.length} settled, backtestable fixture(s) available — far below the ${MIN_SAMPLE_FOR_CONCLUSION} needed to draw any real conclusion. Every metric in this report should be read as a harness smoke-test, not a calibration result, until this grows substantially (see BACKTEST_ASSESSMENT.md).`,
    });
  }

  const highEvBucket = edgeBuckets.find((b) => b.label === "100%+");
  if (highEvBucket && highEvBucket.betsCount > 0 && highEvBucket.actualWinRate !== null && highEvBucket.roi !== null && highEvBucket.roi < 0) {
    findings.push({
      category: "CALIBRATION_PROBLEM",
      finding: `${highEvBucket.betsCount} prediction(s) claimed 100%+ EV but realized ROI of ${(highEvBucket.roi * 100).toFixed(1)}% — the model's most extreme claims are not paying off proportionally, consistent with overconfidence rather than genuine edge.`,
    });
  }

  if (extreme.length > 0 && records.length > 0 && extreme.length / records.length > 0.3) {
    findings.push({
      category: "ENSEMBLE_PROBLEM",
      finding: `${extreme.length} of ${records.length} backtestable fixtures produced an extreme prediction (>=70% probability, >=20% edge, or >=50% EV) — a rate this high in mainstream leagues is itself evidence of systematic miscalibration somewhere in the pipeline, not repeated genuine market inefficiency.`,
    });
  }

  const insufficientCount = records.reduce((sum, r) => sum + r.predictions.filter((p) => p.dataQuality === "INSUFFICIENT").length, 0);
  const totalPredictions = records.reduce((sum, r) => sum + r.predictions.length, 0);
  if (totalPredictions > 0 && insufficientCount / totalPredictions > 0.5) {
    findings.push({
      category: "ODDS_PROBLEM",
      finding: `${insufficientCount} of ${totalPredictions} predictions had INSUFFICIENT data quality, almost always because no bookmaker odds exist for that market yet (Over/Under 1.5, Team Goals have no capture source at all) — these can never become VALUE_BET regardless of model quality.`,
    });
  }

  if (findings.length === 0) {
    findings.push({ category: "UNKNOWN", finding: "No systematic problem pattern detected in this sample — but see the sample-size warning above before treating that as good news." });
  }

  return findings;
}

export function buildBacktestReport(
  backtestable: BacktestableRecord[],
  rejected: RejectedRecord[],
  periodStart: string,
  periodEnd: string,
): BacktestReport {
  const modelCalibration = computeModelDiagnostics(backtestable);
  const edgeBuckets = computeEdgeBuckets(backtestable);
  const extremePredictions = auditExtremePredictions(backtestable);
  const marketBaseline = compareAgainstMarketBaseline(backtestable);
  const agreement = computeAgreement(backtestable);

  const dataQualityCounts: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INSUFFICIENT: 0 };
  for (const r of backtestable) {
    for (const p of r.predictions) {
      dataQualityCounts[p.dataQuality] = (dataQualityCounts[p.dataQuality] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    fixturesConsidered: backtestable.length + rejected.length,
    fixturesBacktestable: backtestable.length,
    fixturesRejected: rejected,
    modelCalibration,
    marketPerformance: summarizeByDecidedMarket(backtestable, (r) => r.decision!.predictionMarket!),
    leaguePerformance: summarizeByDecidedMarket(backtestable, (r) => r.league),
    edgeBuckets,
    extremePredictions,
    agreement,
    marketBaseline,
    dataQualityCounts,
    findings: assessFindings(backtestable, edgeBuckets, extremePredictions),
  };
}

function fmtPct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

export function printReport(report: BacktestReport): string {
  const lines: string[] = [];
  lines.push("BACKTEST REPORT");
  lines.push("===============");
  lines.push("");
  lines.push(`Period: ${report.periodStart} to ${report.periodEnd}`);
  lines.push(`Fixtures considered: ${report.fixturesConsidered}`);
  lines.push(`Fixtures backtestable: ${report.fixturesBacktestable}`);
  lines.push("");

  lines.push("MODEL CALIBRATION");
  lines.push("-----------------");
  for (const m of report.modelCalibration) {
    lines.push(`${m.modelName}: n=${m.sampleSize}, Brier=${m.brierScore ?? "n/a"}, logLoss=${m.logLoss ?? "n/a"}`);
  }
  lines.push("");

  lines.push("MARKET PERFORMANCE");
  lines.push("------------------");
  for (const m of report.marketPerformance) {
    lines.push(`${m.key}: n=${m.betsCount}, winRate=${fmtPct(m.winRate)}, ROI=${fmtPct(m.roi)}${m.sampleWarning ? "  [SAMPLE TOO SMALL]" : ""}`);
  }
  lines.push("");

  lines.push("EDGE ANALYSIS");
  lines.push("-------------");
  for (const b of report.edgeBuckets) {
    lines.push(`${b.label}: n=${b.betsCount}, avgEdge=${fmtPct(b.avgEdge)}, avgEV=${fmtPct(b.avgEv)}, actualWinRate=${fmtPct(b.actualWinRate)}, ROI=${fmtPct(b.roi)}`);
  }
  lines.push("");

  lines.push("EXTREME PREDICTIONS");
  lines.push("--------------------");
  lines.push(`Count: ${report.extremePredictions.length}`);
  for (const e of report.extremePredictions.slice(0, 20)) {
    lines.push(`  ${e.fixture} | ${e.market}/${e.selection} | model=${fmtPct(e.modelProbability)} implied=${fmtPct(e.impliedProbability)} edge=${fmtPct(e.edge)} EV=${fmtPct(e.ev)} actual=${e.actualOutcome}`);
  }
  lines.push("");

  lines.push("LEAGUE PERFORMANCE");
  lines.push("------------------");
  for (const l of report.leaguePerformance) {
    lines.push(`${l.key}: n=${l.betsCount}, winRate=${fmtPct(l.winRate)}, ROI=${fmtPct(l.roi)}${l.sampleWarning ? "  [SAMPLE TOO SMALL]" : ""}`);
  }
  lines.push("");

  lines.push("INTER-MODEL AGREEMENT");
  lines.push("----------------------");
  lines.push(`Predictions with model disagreement data: ${report.agreement.length}`);
  const highDisagreement = report.agreement.filter((a) => a.modelProbabilityStddev > 0.15);
  lines.push(`High-disagreement predictions (stddev > 0.15): ${highDisagreement.length}`);
  for (const a of highDisagreement.slice(0, 10)) {
    lines.push(`  ${a.homeTeam} vs ${a.awayTeam} | ${a.market}/${a.selection} | ${JSON.stringify(a.modelProbabilities)} | mean=${fmtPct(a.modelProbabilityMean)} stddev=${a.modelProbabilityStddev}`);
  }
  lines.push("");

  lines.push("MARKET BASELINE COMPARISON (1X2 only)");
  lines.push("--------------------------------------");
  lines.push(`n=${report.marketBaseline.sampleSize}`);
  lines.push(`  model:             Brier=${report.marketBaseline.model.brierScore ?? "n/a"}, logLoss=${report.marketBaseline.model.logLoss ?? "n/a"}`);
  lines.push(`  raw market:        Brier=${report.marketBaseline.rawMarket.brierScore ?? "n/a"}, logLoss=${report.marketBaseline.rawMarket.logLoss ?? "n/a"}`);
  lines.push(`  normalized market: Brier=${report.marketBaseline.normalizedMarket.brierScore ?? "n/a"}, logLoss=${report.marketBaseline.normalizedMarket.logLoss ?? "n/a"}`);
  lines.push("");

  lines.push("LEAKAGE");
  lines.push("-------");
  lines.push(`Predictions checked: ${report.fixturesConsidered}`);
  lines.push(`Leakage detected: ${report.fixturesRejected.filter((r) => r.reason.startsWith("LEAKAGE_DETECTED")).length}`);
  lines.push(`Other exclusions: ${report.fixturesRejected.filter((r) => !r.reason.startsWith("LEAKAGE_DETECTED")).length}`);
  lines.push("");

  lines.push("DATA QUALITY");
  lines.push("------------");
  for (const [q, count] of Object.entries(report.dataQualityCounts)) {
    lines.push(`${q}: ${count}`);
  }
  lines.push("");

  lines.push('WHAT IS ACTUALLY BROKEN?');
  lines.push("-------------------------");
  for (const f of report.findings) {
    lines.push(`[${f.category}] ${f.finding}`);
  }
  lines.push("");

  lines.push("CONCLUSION");
  lines.push("----------");
  if (report.fixturesBacktestable < MIN_SAMPLE_FOR_CONCLUSION) {
    lines.push(
      `Insufficient data (${report.fixturesBacktestable} backtestable fixtures) to draw any conclusion about model quality, profitability, or calibration. This run verifies the measurement harness works correctly; it is not evidence the model is or isn't good.`,
    );
  } else {
    lines.push("See MODEL CALIBRATION and EDGE ANALYSIS above for the evidence — no summary judgment is asserted here beyond what those numbers show.");
  }

  return lines.join("\n");
}
