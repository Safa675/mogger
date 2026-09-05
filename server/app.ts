import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { ensureSchema } from './schema'
import { getSql } from './db'
import { appUrl } from './env'
import { voteHash } from './hash'
import {
  githubAuthUrl,
  githubProfile,
  googleAuthUrl,
  googleProfile,
  oauthState,
  pkceVerifier,
} from './oauth'
import {
  createSession,
  destroySession,
  isAllowlisted,
  sessionCookieName,
  sessionCookieOpts,
  upsertGithubUser,
  upsertGoogleUser,
  userFromToken,
  type UserRow,
} from './session'
import {
  buildBoard,
  faceReady,
  labelFor,
  loadEnrolled,
  poolIds,
} from './world'
import { SHOTS } from '../src/shots'

type Env = { Variables: { user: UserRow | null } }

export const app = new Hono<Env>().basePath('/api')

function secureCookie(c: { req: { url: string } }): boolean {
  return process.env.NODE_ENV === 'production' || c.req.url.startsWith('https://')
}

function failRedirect(msg: string): Response {
  const u = new URL(appUrl())
  u.searchParams.set('authError', msg)
  return Response.redirect(u.toString(), 302)
}

async function mePayload(user: UserRow) {
  return {
    id: user.id,
    handle: user.handle,
    handleSet: Boolean(user.handle_set),
    isAdmin: Boolean(user.is_admin),
    allowlisted: await isAllowlisted(user),
    importedAt: user.imported_at ? new Date(user.imported_at).toISOString() : null,
    githubLogin: user.github_login,
    email: user.email,
  }
}

app.use('*', async (c, next) => {
  if (c.req.path.endsWith('/health')) {
    await next()
    return
  }
  try {
    await ensureSchema()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Database not configured'
    if (c.req.path.includes('/auth/')) {
      return failRedirect(msg)
    }
    return c.json({ error: msg }, 503)
  }
  const token = getCookie(c, sessionCookieName())
  c.set('user', await userFromToken(token))
  await next()
})

app.get('/health', (c) => c.json({ ok: true }))

app.get('/auth/github', (c) => {
  const state = oauthState()
  setCookie(c, 'oauth_state', state, { ...sessionCookieOpts(secureCookie(c)), maxAge: 600 })
  try {
    return c.redirect(githubAuthUrl(state))
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : 'GitHub OAuth is not configured')
  }
})

app.get('/auth/google', (c) => {
  const state = oauthState()
  const verifier = pkceVerifier()
  const opts = { ...sessionCookieOpts(secureCookie(c)), maxAge: 600 }
  setCookie(c, 'oauth_state', state, opts)
  setCookie(c, 'oauth_verifier', verifier, opts)
  try {
    return c.redirect(googleAuthUrl(state, verifier))
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : 'Google OAuth is not configured')
  }
})

app.get('/auth/callback/github', async (c) => {
  const expected = getCookie(c, 'oauth_state')
  const state = c.req.query('state')
  const code = c.req.query('code')
  deleteCookie(c, 'oauth_state', { path: '/' })
  if (!code || !expected || state !== expected) return failRedirect('GitHub login was cancelled or expired')
  try {
    const profile = await githubProfile(code)
    const user = await upsertGithubUser(profile)
    const token = await createSession(user.id)
    setCookie(c, sessionCookieName(), token, sessionCookieOpts(secureCookie(c)))
    return c.redirect(appUrl())
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : 'GitHub login failed')
  }
})

app.get('/auth/callback/google', async (c) => {
  const expected = getCookie(c, 'oauth_state')
  const verifier = getCookie(c, 'oauth_verifier')
  const state = c.req.query('state')
  const code = c.req.query('code')
  deleteCookie(c, 'oauth_state', { path: '/' })
  deleteCookie(c, 'oauth_verifier', { path: '/' })
  if (!code || !expected || !verifier || state !== expected) {
    return failRedirect('Google login was cancelled or expired')
  }
  try {
    const profile = await googleProfile(code, verifier)
    const user = await upsertGoogleUser(profile)
    const token = await createSession(user.id)
    setCookie(c, sessionCookieName(), token, sessionCookieOpts(secureCookie(c)))
    return c.redirect(appUrl())
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : 'Google login failed')
  }
})

app.post('/auth/logout', async (c) => {
  await destroySession(getCookie(c, sessionCookieName()))
  deleteCookie(c, sessionCookieName(), { path: '/' })
  return c.json({ ok: true })
})

app.get('/state', async (c) => {
  const user = c.get('user')
  const enrolled = await loadEnrolled()
  const { board, played, voteCount } = await buildBoard(enrolled)
  const sql = getSql()
  const last = (await sql`
    SELECT id, voter_id FROM votes WHERE voided_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1
  `) as Array<{ id: string; voter_id: string }>
  const lastVote = last[0] ?? null
  const canUndo = Boolean(user && lastVote && lastVote.voter_id === user.id)
  let allowlist: Array<{ id: string; githubLogin: string | null; email: string | null }> | undefined
  if (user && Boolean(user.is_admin)) {
    const rows = (await sql`SELECT id, github_login, email FROM allowlist ORDER BY created_at`) as Array<{
      id: string
      github_login: string | null
      email: string | null
    }>
    allowlist = rows.map((r) => ({ id: r.id, githubLogin: r.github_login, email: r.email }))
  }
  return c.json({
    me: user ? await mePayload(user) : null,
    enrolled,
    board,
    played,
    voteCount,
    canUndo,
    allowlist: allowlist ?? null,
  })
})

app.get('/feed', async (c) => {
  const enrolled = await loadEnrolled()
  const sql = getSql()
  const votes = (await sql`
    SELECT v.id, v.winner_id, v.loser_id, v.created_at, v.voided_at, v.void_reason, v.hash, u.handle
    FROM votes v
    JOIN users u ON u.id = v.voter_id
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT 80
  `) as Array<{
    id: string
    winner_id: string
    loser_id: string
    created_at: string
    voided_at: string | null
    void_reason: string | null
    hash: string
    handle: string
  }>
  const resets = (await sql`
    SELECT r.id, r.created_at, u.handle
    FROM board_resets r
    JOIN users u ON u.id = r.by_user_id
    ORDER BY r.created_at DESC
    LIMIT 20
  `) as Array<{ id: string; created_at: string; handle: string }>
  const items = [
    ...votes.map((v) => ({
      kind: 'vote' as const,
      id: v.id,
      at: new Date(v.created_at).toISOString(),
      handle: v.handle,
      winner: labelFor(v.winner_id, enrolled),
      loser: labelFor(v.loser_id, enrolled),
      voided: Boolean(v.voided_at),
      voidReason: v.void_reason,
      hash: v.hash,
    })),
    ...resets.map((r) => ({
      kind: 'reset' as const,
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      handle: r.handle,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return c.json({ items: items.slice(0, 80) })
})

app.post('/me/handle', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Sign in first' }, 401)
  if (Boolean(user.handle_set)) return c.json({ error: 'Handle is already set' }, 409)
  const body = (await c.req.json()) as { handle?: string }
  const raw = (body.handle || '').trim()
  if (!/^[a-zA-Z0-9_]{2,24}$/.test(raw)) {
    return c.json({ error: 'Handle: 2–24 letters, numbers, underscore' }, 400)
  }
  const sql = getSql()
  const taken = await sql`SELECT 1 FROM users WHERE lower(handle) = ${raw.toLowerCase()} AND id <> ${user.id} LIMIT 1`
  if (taken.length) return c.json({ error: 'That handle is taken' }, 409)
  await sql`UPDATE users SET handle = ${raw}, handle_set = TRUE WHERE id = ${user.id}`
  return c.json({ ok: true, handle: raw })
})

app.post('/votes', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Sign in to vote' }, 401)
  if (!Boolean(user.handle_set)) return c.json({ error: 'Set your handle first' }, 400)
  if (!(await isAllowlisted(user))) return c.json({ error: 'You are not on the voter list yet' }, 403)
  const body = (await c.req.json()) as { winnerId?: string; loserId?: string }
  const winnerId = body.winnerId || ''
  const loserId = body.loserId || ''
  if (!winnerId || !loserId || winnerId === loserId) return c.json({ error: 'Pick two different faces' }, 400)
  const enrolled = await loadEnrolled()
  const ids = poolIds(enrolled)
  if (!ids.has(winnerId) || !ids.has(loserId)) return c.json({ error: 'Unknown face' }, 400)
  const sql = getSql()
  const recent = (await sql`
    SELECT created_at FROM votes WHERE voter_id = ${user.id}
    ORDER BY created_at DESC LIMIT 1
  `) as Array<{ created_at: string }>
  if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 800) {
    return c.json({ error: 'Slow down' }, 429)
  }
  const head = (await sql`
    SELECT hash FROM votes ORDER BY created_at DESC, id DESC LIMIT 1
  `) as Array<{ hash: string }>
  const prev = head[0]?.hash ?? 'genesis'
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const hash = voteHash(prev, id, user.id, winnerId, loserId, createdAt)
  await sql`
    INSERT INTO votes (id, voter_id, winner_id, loser_id, created_at, prev_hash, hash)
    VALUES (${id}, ${user.id}, ${winnerId}, ${loserId}, ${createdAt}, ${prev}, ${hash})
  `
  return c.json({ ok: true, id, hash })
})

app.post('/votes/undo', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Sign in first' }, 401)
  const sql = getSql()
  const last = (await sql`
    SELECT id, voter_id FROM votes WHERE voided_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1
  `) as Array<{ id: string; voter_id: string }>
  if (!last[0] || last[0].voter_id !== user.id) {
    return c.json({ error: 'Nothing to undo' }, 409)
  }
  await sql`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${'undo'}
    WHERE id = ${last[0].id} AND voided_at IS NULL
  `
  return c.json({ ok: true })
})

app.post('/votes/:id/void', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const id = c.req.param('id')
  const sql = getSql()
  const rows = await sql`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${'admin'}
    WHERE id = ${id} AND voided_at IS NULL
    RETURNING id
  `
  if (!rows.length) return c.json({ error: 'Already voided or missing' }, 409)
  return c.json({ ok: true })
})

app.post('/board/wipe', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const sql = getSql()
  await sql`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${'wipe'}
    WHERE voided_at IS NULL
  `
  await sql`INSERT INTO board_resets (id, by_user_id) VALUES (${crypto.randomUUID()}, ${user.id})`
  return c.json({ ok: true })
})

app.post('/import', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Sign in first' }, 401)
  if (user.imported_at) return c.json({ error: 'This account already imported local votes' }, 409)
  if (!(await isAllowlisted(user))) return c.json({ error: 'You are not on the voter list yet' }, 403)
  const body = (await c.req.json()) as {
    votes?: Array<{ winnerId: string; loserId: string }>
    users?: Array<{ id: string; name: string; photos: Record<string, string> }>
  }
  const votes = Array.isArray(body.votes) ? body.votes : []
  const users = Array.isArray(body.users) ? body.users : []
  const sql = getSql()
  if (Boolean(user.is_admin)) {
    for (const u of users) {
      if (!u?.id || !u.photos || !faceReady(u.photos)) continue
      await sql`
        INSERT INTO enrolled_faces (id, name, uploaded_by)
        VALUES (${u.id}, ${u.name?.trim() || u.id}, ${user.id})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `
      for (const [key, dataUrl] of Object.entries(u.photos)) {
        if (!SHOTS.some((s) => s.key === key) || typeof dataUrl !== 'string') continue
        await sql`
          INSERT INTO enrolled_photos (face_id, shot_key, data_url)
          VALUES (${u.id}, ${key}, ${dataUrl})
          ON CONFLICT (face_id, shot_key) DO UPDATE SET data_url = EXCLUDED.data_url
        `
      }
    }
  }
  const enrolled = await loadEnrolled()
  const ids = poolIds(enrolled)
  let head = (await sql`SELECT hash FROM votes ORDER BY created_at DESC, id DESC LIMIT 1`) as Array<{
    hash: string
  }>
  let prev = head[0]?.hash ?? 'genesis'
  let n = 0
  const t0 = Date.now()
  for (const v of votes) {
    if (!v?.winnerId || !v?.loserId || v.winnerId === v.loserId) continue
    if (!ids.has(v.winnerId) || !ids.has(v.loserId)) continue
    const id = crypto.randomUUID()
    const createdAt = new Date(t0 + n).toISOString()
    const hash = voteHash(prev, id, user.id, v.winnerId, v.loserId, createdAt)
    await sql`
      INSERT INTO votes (id, voter_id, winner_id, loser_id, created_at, prev_hash, hash)
      VALUES (${id}, ${user.id}, ${v.winnerId}, ${v.loserId}, ${createdAt}, ${prev}, ${hash})
    `
    prev = hash
    n++
  }
  await sql`UPDATE users SET imported_at = NOW() WHERE id = ${user.id}`
  return c.json({ ok: true, imported: n })
})

app.post('/faces', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const body = (await c.req.json()) as {
    id?: string
    name?: string
    photos?: Record<string, string>
  }
  const photos = body.photos && typeof body.photos === 'object' ? body.photos : {}
  if (!faceReady(photos)) {
    return c.json({ error: 'Need Front and one true profile (left or right)' }, 400)
  }
  const id = body.id && /^u-/.test(body.id) ? body.id : `u-${crypto.randomUUID().slice(0, 8)}`
  const name = (body.name || '').trim() || id
  const sql = getSql()
  await sql`
    INSERT INTO enrolled_faces (id, name, uploaded_by)
    VALUES (${id}, ${name}, ${user.id})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `
  await sql`DELETE FROM enrolled_photos WHERE face_id = ${id}`
  for (const [key, dataUrl] of Object.entries(photos)) {
    if (!SHOTS.some((s) => s.key === key) || typeof dataUrl !== 'string') continue
    await sql`
      INSERT INTO enrolled_photos (face_id, shot_key, data_url)
      VALUES (${id}, ${key}, ${dataUrl})
    `
  }
  return c.json({ ok: true, id })
})

app.delete('/faces/:id', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const id = c.req.param('id')
  const sql = getSql()
  const used = await sql`
    SELECT 1 FROM votes WHERE (winner_id = ${id} OR loser_id = ${id}) AND voided_at IS NULL LIMIT 1
  `
  if (used.length) return c.json({ error: 'Cannot delete after a battle' }, 409)
  await sql`DELETE FROM enrolled_faces WHERE id = ${id}`
  return c.json({ ok: true })
})

app.post('/allowlist', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const body = (await c.req.json()) as { githubLogin?: string; email?: string }
  const githubLogin = body.githubLogin?.trim().toLowerCase() || null
  const email = body.email?.trim().toLowerCase() || null
  if (!githubLogin && !email) return c.json({ error: 'Need a GitHub username or email' }, 400)
  const sql = getSql()
  try {
    await sql`
      INSERT INTO allowlist (id, github_login, email, added_by)
      VALUES (${crypto.randomUUID()}, ${githubLogin}, ${email}, ${user.id})
    `
  } catch {
    return c.json({ error: 'Already on the list' }, 409)
  }
  return c.json({ ok: true })
})

app.delete('/allowlist/:id', async (c) => {
  const user = c.get('user')
  if (!user || !Boolean(user.is_admin)) return c.json({ error: 'Admin only' }, 403)
  const sql = getSql()
  await sql`DELETE FROM allowlist WHERE id = ${c.req.param('id')}`
  return c.json({ ok: true })
})
