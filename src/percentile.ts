/** Competition rank (1,1,1,4,…) plus mid-rank for percentile so ties share a label. */
export type RankInfo = {
  rank: number
  midRank: number
  tied: number
}

function eloKey(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function ranksFromElo(
  elo: Record<string, number>,
  ids: string[],
): Record<string, RankInfo> {
  const sorted = [...ids].sort((a, b) => {
    const d = elo[b] - elo[a]
    if (d !== 0) return d
    return a.localeCompare(b)
  })

  const out: Record<string, RankInfo> = {}
  let i = 0
  while (i < sorted.length) {
    const key = eloKey(elo[sorted[i]])
    let j = i + 1
    while (j < sorted.length && eloKey(elo[sorted[j]]) === key) j++
    const tied = j - i
    const rank = i + 1
    const midRank = (i + j + 1) / 2
    for (let k = i; k < j; k++) {
      out[sorted[k]] = { rank, midRank, tied }
    }
    i = j
  }
  return out
}

/** Share of the pool this rank outranks. Rank 1 of n → almost 100. Rank n → 0. */
export function beatsPercent(rank: number, n: number): number {
  if (n <= 0) return 0
  return ((n - rank) / n) * 100
}
