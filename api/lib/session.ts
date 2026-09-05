import { getSql } from './db'
import { adminGithubLogin } from './env'
import { randomToken, suggestHandle } from './hash'

export type UserRow = {
  id: string
  handle: string
  handle_set: boolean
  github_id: string | null
  github_login: string | null
  google_id: string | null
  email: string | null
  is_admin: boolean
  imported_at: string | Date | null
  created_at: string | Date
}

const COOKIE = 'mogger_session'
const DAY = 1000 * 60 * 60 * 24 * 30

export function sessionCookieName(): string {
  return COOKIE
}

export function sessionCookieOpts(secure: boolean) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secure,
    maxAge: 60 * 60 * 24 * 30,
  }
}

export async function uniqueHandle(base: string): Promise<string> {
  const sql = getSql()
  const root = suggestHandle(base)
  let h = root
  for (let n = 2; n < 50; n++) {
    const rows = await sql`SELECT 1 FROM users WHERE lower(handle) = ${h} LIMIT 1`
    if (rows.length === 0) return h
    h = `${root.slice(0, 20)}${n}`
  }
  return `${root}${randomToken().slice(0, 6)}`
}

export async function createSession(userId: string): Promise<string> {
  const sql = getSql()
  const token = randomToken()
  const expires = new Date(Date.now() + DAY)
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expires.toISOString()})`
  return token
}

export async function userFromToken(token: string | undefined): Promise<UserRow | null> {
  if (!token) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `) as UserRow[]
  return rows[0] ?? null
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return
  const sql = getSql()
  await sql`DELETE FROM sessions WHERE token = ${token}`
}

export async function isAllowlisted(user: UserRow): Promise<boolean> {
  if (user.is_admin) return true
  const sql = getSql()
  if (user.github_login) {
    const gh = await sql`
      SELECT 1 FROM allowlist WHERE lower(github_login) = ${user.github_login.toLowerCase()} LIMIT 1
    `
    if (gh.length) return true
  }
  if (user.email) {
    const em = await sql`
      SELECT 1 FROM allowlist WHERE lower(email) = ${user.email.toLowerCase()} LIMIT 1
    `
    if (em.length) return true
  }
  return false
}

export async function upsertGithubUser(profile: {
  id: string
  login: string
  email: string | null
}): Promise<UserRow> {
  const sql = getSql()
  const admin = profile.login.toLowerCase() === adminGithubLogin()
  const existing = (await sql`
    SELECT * FROM users WHERE github_id = ${profile.id} LIMIT 1
  `) as UserRow[]
  if (existing[0]) {
    if (admin && !existing[0].is_admin) {
      await sql`UPDATE users SET is_admin = TRUE, github_login = ${profile.login.toLowerCase()} WHERE id = ${existing[0].id}`
      return { ...existing[0], is_admin: true, github_login: profile.login.toLowerCase() }
    }
    return existing[0]
  }
  const handle = await uniqueHandle(profile.login)
  const id = crypto.randomUUID()
  try {
    const rows = (await sql`
      INSERT INTO users (id, handle, handle_set, github_id, github_login, email, is_admin)
      VALUES (
        ${id},
        ${handle},
        ${false},
        ${profile.id},
        ${profile.login.toLowerCase()},
        ${profile.email},
        ${admin}
      )
      RETURNING *
    `) as UserRow[]
    return rows[0]
  } catch {
    throw new Error('This GitHub account or email is already used with a different login')
  }
}

export async function upsertGoogleUser(profile: {
  id: string
  email: string
  name: string | null
}): Promise<UserRow> {
  const sql = getSql()
  const existing = (await sql`
    SELECT * FROM users WHERE google_id = ${profile.id} LIMIT 1
  `) as UserRow[]
  if (existing[0]) return existing[0]
  const handle = await uniqueHandle(profile.name || profile.email.split('@')[0] || 'user')
  const id = crypto.randomUUID()
  try {
    const rows = (await sql`
      INSERT INTO users (id, handle, handle_set, google_id, email, is_admin)
      VALUES (${id}, ${handle}, ${false}, ${profile.id}, ${profile.email.toLowerCase()}, ${false})
      RETURNING *
    `) as UserRow[]
    return rows[0]
  } catch {
    throw new Error('This Google account or email is already used with a different login')
  }
}
