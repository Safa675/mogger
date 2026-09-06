import type { Board } from './board'
import type { Face } from './pool'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Me = {
  id: string
  handle: string
  handleSet: boolean
  isAdmin: boolean
  isGuest: boolean
  allowlisted: boolean
  importedAt: string | null
  githubLogin: string | null
  email: string | null
}

export type WorldState = {
  me: Me | null
  enrolled: Face[]
  board: Board
  played: Record<string, number>
  voteCount: number
  canUndo: boolean
  allowlist: Array<{ id: string; githubLogin: string | null; email: string | null }> | null
}

export type FeedItem =
  | {
      kind: 'vote'
      id: string
      at: string
      handle: string
      winner: string
      loser: string
      voided: boolean
      voidReason: string | null
      hash: string
    }
  | { kind: 'reset'; id: string; at: string; handle: string }

async function parse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text }
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data = (await parse(res)) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText)
  return data as T
}

export function loadState(): Promise<WorldState> {
  return api<WorldState>('/api/state')
}

export function loadFeed(): Promise<{ items: FeedItem[] }> {
  return api('/api/feed')
}
