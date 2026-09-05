import { getSql } from './db'

let ready: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (!ready) ready = migrate()
  return ready
}

async function migrate(): Promise<void> {
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      handle_set BOOLEAN NOT NULL DEFAULT FALSE,
      github_id TEXT UNIQUE,
      github_login TEXT UNIQUE,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      imported_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS allowlist (
      id TEXT PRIMARY KEY,
      github_login TEXT,
      email TEXT,
      added_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS allowlist_github ON allowlist (lower(github_login)) WHERE github_login IS NOT NULL`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS allowlist_email ON allowlist (lower(email)) WHERE email IS NOT NULL`
  await sql`
    CREATE TABLE IF NOT EXISTS enrolled_faces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS enrolled_photos (
      face_id TEXT NOT NULL REFERENCES enrolled_faces (id) ON DELETE CASCADE,
      shot_key TEXT NOT NULL,
      data_url TEXT NOT NULL,
      PRIMARY KEY (face_id, shot_key)
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      voter_id TEXT NOT NULL REFERENCES users (id),
      winner_id TEXT NOT NULL,
      loser_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      voided_at TIMESTAMPTZ,
      voided_by TEXT REFERENCES users (id),
      void_reason TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    )`
  await sql`CREATE INDEX IF NOT EXISTS votes_created ON votes (created_at DESC)`
  await sql`
    CREATE TABLE IF NOT EXISTS board_resets (
      id TEXT PRIMARY KEY,
      by_user_id TEXT NOT NULL REFERENCES users (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`
    INSERT INTO allowlist (id, github_login)
    SELECT ${crypto.randomUUID()}, ${'safa675'}
    WHERE NOT EXISTS (
      SELECT 1 FROM allowlist WHERE lower(github_login) = ${'safa675'}
    )`
}
