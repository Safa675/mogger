import { londonFaces, INITIAL_ELO, type Face } from './pool'
import { applyWin } from './elo'
import { canEnterPool } from './shots'

const KEY = 'mogger.v001'

export type Vote = {
  winnerId: string
  loserId: string
}

export type StoredUser = {
  id: string
  name: string
  photos: Record<string, string>
}

export type Saved = {
  votes: Vote[]
  users: StoredUser[]
}

function emptySaved(): Saved {
  return { votes: [], users: [] }
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptySaved()
    const parsed = JSON.parse(raw) as Partial<Saved>
    const votes = Array.isArray(parsed.votes)
      ? parsed.votes.filter((v) => v && v.winnerId && v.loserId)
      : []
    const users = Array.isArray(parsed.users)
      ? parsed.users.filter(
          (u) => u && typeof u.id === 'string' && u.photos && typeof u.photos === 'object',
        )
      : []
    return { votes, users }
  } catch {
    return emptySaved()
  }
}

export function persistSaved(saved: Saved): void {
  localStorage.setItem(KEY, JSON.stringify(saved))
}

export function userToFace(u: StoredUser): Face {
  return {
    id: u.id,
    source: 'user',
    name: u.name.trim() || u.id,
    age: null,
    ethnicity: '',
    labMean: null,
    labRank: null,
    photoKeys: Object.keys(u.photos),
    photos: u.photos,
  }
}

export function activePool(users: StoredUser[]): Face[] {
  const eligible = users.filter((u) => canEnterPool(Object.keys(u.photos))).map(userToFace)
  return [...londonFaces, ...eligible]
}

export function eloFromVotes(
  votes: Vote[],
  ids: string[],
): Record<string, number> {
  const elo: Record<string, number> = {}
  for (const id of ids) elo[id] = INITIAL_ELO
  for (const v of votes) {
    if (!(v.winnerId in elo) || !(v.loserId in elo)) continue
    const next = applyWin(elo[v.winnerId], elo[v.loserId])
    elo[v.winnerId] = next.winner
    elo[v.loserId] = next.loser
  }
  return elo
}

export function matchesOf(id: string, votes: Vote[]): number {
  let n = 0
  for (const v of votes) {
    if (v.winnerId === id || v.loserId === id) n++
  }
  return n
}

export function clearVotesKeepUsers(users: StoredUser[]): void {
  persistSaved({ votes: [], users })
}
