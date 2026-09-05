import { createHash, randomBytes } from 'node:crypto'
import { appUrl } from './env'

export function oauthState(): string {
  return randomBytes(16).toString('hex')
}

export function pkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function githubAuthUrl(state: string): string {
  const id = process.env.GITHUB_CLIENT_ID
  if (!id) throw new Error('GITHUB_CLIENT_ID is not set')
  const redirect = `${appUrl()}/api/auth/callback/github`
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    scope: 'read:user user:email',
    state,
  })
  return `https://github.com/login/oauth/authorize?${q}`
}

export function googleAuthUrl(state: string, verifier: string): string {
  const id = process.env.GOOGLE_CLIENT_ID
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set')
  const redirect = `${appUrl()}/api/auth/callback/google`
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

export async function githubProfile(code: string): Promise<{
  id: string
  login: string
  email: string | null
}> {
  const id = process.env.GITHUB_CLIENT_ID
  const secret = process.env.GITHUB_CLIENT_SECRET
  if (!id || !secret) throw new Error('GitHub OAuth is not configured')
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: `${appUrl()}/api/auth/callback/github`,
    }),
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenJson.access_token) throw new Error(tokenJson.error || 'GitHub token failed')
  const headers = {
    Authorization: `Bearer ${tokenJson.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mogger',
  }
  const userRes = await fetch('https://api.github.com/user', { headers })
  const user = (await userRes.json()) as { id?: number; login?: string; email?: string | null }
  if (!user.id || !user.login) throw new Error('GitHub profile failed')
  let email = user.email ?? null
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', { headers })
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string
        primary: boolean
        verified: boolean
      }>
      const picked =
        emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0]
      email = picked?.email ?? null
    }
  }
  return { id: String(user.id), login: user.login, email }
}

export async function googleProfile(
  code: string,
  verifier: string,
): Promise<{ id: string; email: string; name: string | null }> {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new Error('Google OAuth is not configured')
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${appUrl()}/api/auth/callback/google`,
    code_verifier: verifier,
  })
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenJson.access_token) throw new Error(tokenJson.error || 'Google token failed')
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  const info = (await infoRes.json()) as {
    sub?: string
    email?: string
    name?: string
    email_verified?: boolean
  }
  if (!info.sub || !info.email) throw new Error('Google profile failed')
  return { id: info.sub, email: info.email, name: info.name ?? null }
}
