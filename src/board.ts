import type { Face, FaceSource } from './pool'
import { ranksFromElo, beatsPercent } from './percentile'
import { tierFromBeatsPct, type TierLabel } from './tiers'
import type { Vote } from './storage'

export type RecordW = { wins: number; losses: number }

export type BoardRow = {
  id: string
  name: string
  rank: number
  elo: number
  wins: number
  losses: number
  matches: number
  beatsPct: number | null
  score: number | null
  label: TierLabel | null
  labMean: number | null
  labRank: number | null
  source: FaceSource
}

export type Board = {
  rated: BoardRow[]
  unratedCount: number
  labelsOn: boolean
  poolSize: number
}

export function recordById(votes: Vote[]): Record<string, RecordW> {
  const rec: Record<string, RecordW> = {}
  const bump = (id: string) => {
    if (!rec[id]) rec[id] = { wins: 0, losses: 0 }
  }
  for (const v of votes) {
    bump(v.winnerId)
    bump(v.loserId)
    rec[v.winnerId].wins++
    rec[v.loserId].losses++
  }
  return rec
}

export function computeBoard(
  elo: Record<string, number>,
  pool: Face[],
  votes: Vote[],
): Board {
  const rec = recordById(votes)
  const played = (id: string) => (rec[id]?.wins ?? 0) + (rec[id]?.losses ?? 0)
  const labelsOn = pool.length > 0 && pool.every((f) => played(f.id) > 0)
  const ratedFaces = pool.filter((f) => played(f.id) > 0)
  const rankIds = labelsOn ? pool.map((f) => f.id) : ratedFaces.map((f) => f.id)
  const ranks = ranksFromElo(elo, rankIds)
  const nForPct = pool.length

  const rated: BoardRow[] = ratedFaces
    .map((f) => {
      const info = ranks[f.id]
      let beatsPct: number | null = null
      let score: number | null = null
      let label: TierLabel | null = null
      if (labelsOn && info) {
        const tier = tierFromBeatsPct(beatsPercent(info.midRank, nForPct))
        beatsPct = tier.beatsPct
        score = tier.score
        label = tier.label
      }
      return {
        id: f.id,
        name: f.name,
        rank: info?.rank ?? 0,
        elo: elo[f.id] ?? 1500,
        wins: rec[f.id]?.wins ?? 0,
        losses: rec[f.id]?.losses ?? 0,
        matches: played(f.id),
        beatsPct,
        score,
        label,
        labMean: f.labMean,
        labRank: f.labRank,
        source: f.source,
      }
    })
    .sort((a, b) => b.elo - a.elo || a.id.localeCompare(b.id))

  return {
    rated,
    unratedCount: pool.length - ratedFaces.length,
    labelsOn,
    poolSize: pool.length,
  }
}
