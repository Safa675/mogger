import { londonFaces, type Face } from '../src/pool'
import { canEnterPool } from '../src/shots'
import { eloFromVotes } from '../src/storage'
import { computeBoard, recordById } from '../src/board'
import { getSql } from './db'

export type EnrolledRow = { id: string; name: string }

export async function loadEnrolled(): Promise<Face[]> {
  const sql = getSql()
  const faces = (await sql`SELECT id, name FROM enrolled_faces ORDER BY created_at`) as EnrolledRow[]
  if (faces.length === 0) return []
  const photos = (await sql`SELECT face_id, shot_key, data_url FROM enrolled_photos`) as Array<{
    face_id: string
    shot_key: string
    data_url: string
  }>
  const by: Record<string, Record<string, string>> = {}
  for (const p of photos) {
    ;(by[p.face_id] ||= {})[p.shot_key] = p.data_url
  }
  return faces.map((f) => {
    const rec = by[f.id] ?? {}
    return {
      id: f.id,
      source: 'user' as const,
      name: f.name,
      age: null,
      ethnicity: '',
      labMean: null,
      labRank: null,
      photoKeys: Object.keys(rec),
      photos: rec,
    }
  })
}

export function worldPool(enrolled: Face[]): Face[] {
  return [...londonFaces, ...enrolled]
}

export async function activeVotes(): Promise<Array<{ winnerId: string; loserId: string }>> {
  const sql = getSql()
  const rows = (await sql`
    SELECT winner_id, loser_id FROM votes
    WHERE voided_at IS NULL
    ORDER BY created_at ASC, id ASC
  `) as Array<{ winner_id: string; loser_id: string }>
  return rows.map((r) => ({ winnerId: r.winner_id, loserId: r.loser_id }))
}

export async function buildBoard(enrolled: Face[]) {
  const pool = worldPool(enrolled)
  const votes = await activeVotes()
  const elo = eloFromVotes(votes, pool.map((f) => f.id))
  const board = computeBoard(elo, pool, votes)
  const rec = recordById(votes)
  const played: Record<string, number> = {}
  for (const [id, r] of Object.entries(rec)) {
    played[id] = r.wins + r.losses
  }
  return { pool, votes, board, played, voteCount: votes.length }
}

export function poolIds(enrolled: Face[]): Set<string> {
  return new Set(worldPool(enrolled).map((f) => f.id))
}

export function faceReady(photos: Record<string, string>): boolean {
  return canEnterPool(Object.keys(photos))
}

export function labelFor(id: string, enrolled: Face[]): string {
  const user = enrolled.find((f) => f.id === id)
  if (user) return user.name
  return `#${id}`
}
