export type TierLabel =
  | 'Sub 3'
  | 'Sub 5'
  | 'LTN'
  | 'MTN'
  | 'HTN'
  | 'Chadlite'
  | 'Chad'

export type TierResult = {
  beatsPct: number
  score: number
  label: TierLabel
}

/**
 * Pool percentile (0 = worst, ~100 = best) → 1–10 score.
 * 30% of the pool maps into 1–3, 20% into 3–5, then +1 point per 10% from 5→10.
 * Display score is capped below 10 so True Adam is never assigned.
 */
export function scoreFromBeatsPct(beatsPct: number): number {
  const p = Math.min(100, Math.max(0, beatsPct))
  let score: number
  if (p < 30) score = 1 + (p / 30) * 2
  else if (p < 50) score = 3 + ((p - 30) / 20) * 2
  else if (p < 60) score = 5 + (p - 50) / 10
  else if (p < 70) score = 6 + (p - 60) / 10
  else if (p < 80) score = 7 + (p - 70) / 10
  else if (p < 90) score = 8 + (p - 80) / 10
  else score = 9 + (p - 90) / 10
  return Math.min(score, 9.99)
}

export function labelFromScore(score: number): TierLabel {
  if (score < 3) return 'Sub 3'
  if (score < 5) return 'Sub 5'
  if (score < 6) return 'LTN'
  if (score < 7) return 'MTN'
  if (score < 8) return 'HTN'
  if (score < 9) return 'Chadlite'
  return 'Chad'
}

export function tierFromBeatsPct(beatsPct: number): TierResult {
  const score = scoreFromBeatsPct(beatsPct)
  return { beatsPct, score, label: labelFromScore(score) }
}

export const TIER_LEGEND: Array<{
  label: TierLabel
  score: string
  poolPct: string
  share: string
}> = [
  { label: 'Sub 3', score: '< 3', poolPct: '0–30', share: '30%' },
  { label: 'Sub 5', score: '3–5', poolPct: '30–50', share: '20%' },
  { label: 'LTN', score: '5–6', poolPct: '50–60', share: '10%' },
  { label: 'MTN', score: '6–7', poolPct: '60–70', share: '10%' },
  { label: 'HTN', score: '7–8', poolPct: '70–80', share: '10%' },
  { label: 'Chadlite', score: '8–9', poolPct: '80–90', share: '10%' },
  { label: 'Chad', score: '9–10', poolPct: '90–100', share: '10%' },
]
