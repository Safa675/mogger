export const K = 32

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

export function applyWin(
  winnerElo: number,
  loserElo: number,
): { winner: number; loser: number } {
  const pWin = expectedScore(winnerElo, loserElo)
  return {
    winner: winnerElo + K * (1 - pWin),
    loser: loserElo + K * (0 - (1 - pWin)),
  }
}
