import { createHash, randomBytes } from 'node:crypto'

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function voteHash(
  prev: string,
  id: string,
  voterId: string,
  winnerId: string,
  loserId: string,
  createdAt: string,
): string {
  return sha256(`${prev}|${id}|${voterId}|${winnerId}|${loserId}|${createdAt}`)
}

export function randomToken(): string {
  return randomBytes(24).toString('base64url')
}

export function suggestHandle(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24)
  return s || 'user'
}
