// api/_lib/app.ts
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// api/_lib/db.ts
import postgres from "postgres";

// api/_lib/env.ts
function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:5173";
}
function adminGithubLogin() {
  return (process.env.ADMIN_GITHUB_LOGIN || "Safa675").toLowerCase();
}
function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

// api/_lib/db.ts
var sql = null;
function getSql() {
  if (!sql) {
    const url = databaseUrl();
    const local = /localhost|127\.0\.0\.1/.test(url);
    sql = postgres(url, {
      max: 1,
      ssl: local ? false : "require",
      connect_timeout: 8,
      idle_timeout: 20
    });
  }
  return sql;
}

// api/_lib/schema.ts
var ready = null;
function ensureSchema() {
  if (!ready) ready = migrate();
  return ready;
}
async function migrate() {
  const sql2 = getSql();
  await sql2`
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
    )`;
  await sql2`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql2`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )`;
  await sql2`
    CREATE TABLE IF NOT EXISTS allowlist (
      id TEXT PRIMARY KEY,
      github_login TEXT,
      email TEXT,
      added_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql2`CREATE UNIQUE INDEX IF NOT EXISTS allowlist_github ON allowlist (lower(github_login)) WHERE github_login IS NOT NULL`;
  await sql2`CREATE UNIQUE INDEX IF NOT EXISTS allowlist_email ON allowlist (lower(email)) WHERE email IS NOT NULL`;
  await sql2`
    CREATE TABLE IF NOT EXISTS enrolled_faces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql2`
    CREATE TABLE IF NOT EXISTS enrolled_photos (
      face_id TEXT NOT NULL REFERENCES enrolled_faces (id) ON DELETE CASCADE,
      shot_key TEXT NOT NULL,
      data_url TEXT NOT NULL,
      PRIMARY KEY (face_id, shot_key)
    )`;
  await sql2`
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
    )`;
  await sql2`CREATE INDEX IF NOT EXISTS votes_created ON votes (created_at DESC)`;
  await sql2`
    CREATE TABLE IF NOT EXISTS board_resets (
      id TEXT PRIMARY KEY,
      by_user_id TEXT NOT NULL REFERENCES users (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql2`
    INSERT INTO allowlist (id, github_login)
    SELECT ${crypto.randomUUID()}, ${"safa675"}
    WHERE NOT EXISTS (
      SELECT 1 FROM allowlist WHERE lower(github_login) = ${"safa675"}
    )`;
}

// api/_lib/hash.ts
import { createHash, randomBytes } from "node:crypto";
function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}
function voteHash(prev, id, voterId, winnerId, loserId, createdAt) {
  return sha256(`${prev}|${id}|${voterId}|${winnerId}|${loserId}|${createdAt}`);
}
function randomToken() {
  return randomBytes(24).toString("base64url");
}
function suggestHandle(raw) {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return s || "user";
}

// api/_lib/oauth.ts
import { createHash as createHash2, randomBytes as randomBytes2 } from "node:crypto";
function oauthState() {
  return randomBytes2(16).toString("hex");
}
function pkceVerifier() {
  return randomBytes2(32).toString("base64url");
}
function pkceChallenge(verifier) {
  return createHash2("sha256").update(verifier).digest("base64url");
}
function githubAuthUrl(state) {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) throw new Error("GITHUB_CLIENT_ID is not set");
  const redirect = `${appUrl()}/api/auth/callback/github`;
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    scope: "read:user user:email",
    state
  });
  return `https://github.com/login/oauth/authorize?${q}`;
}
function googleAuthUrl(state, verifier) {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  const redirect = `${appUrl()}/api/auth/callback/google`;
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function githubProfile(code) {
  const id = process.env.GITHUB_CLIENT_ID;
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GitHub OAuth is not configured");
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: `${appUrl()}/api/auth/callback/github`
    })
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error(tokenJson.error || "GitHub token failed");
  const headers = {
    Authorization: `Bearer ${tokenJson.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "mogger"
  };
  const userRes = await fetch("https://api.github.com/user", { headers });
  const user = await userRes.json();
  if (!user.id || !user.login) throw new Error("GitHub profile failed");
  let email = user.email ?? null;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const picked = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
      email = picked?.email ?? null;
    }
  }
  return { id: String(user.id), login: user.login, email };
}
async function googleProfile(code, verifier) {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google OAuth is not configured");
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    code,
    grant_type: "authorization_code",
    redirect_uri: `${appUrl()}/api/auth/callback/google`,
    code_verifier: verifier
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error(tokenJson.error || "Google token failed");
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const info = await infoRes.json();
  if (!info.sub || !info.email) throw new Error("Google profile failed");
  return { id: info.sub, email: info.email, name: info.name ?? null };
}

// api/_lib/session.ts
var COOKIE = "mogger_session";
var DAY = 1e3 * 60 * 60 * 24 * 30;
function sessionCookieName() {
  return COOKIE;
}
function sessionCookieOpts(secure) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
    maxAge: 60 * 60 * 24 * 30
  };
}
async function uniqueHandle(base) {
  const sql2 = getSql();
  const root = suggestHandle(base);
  let h = root;
  for (let n = 2; n < 50; n++) {
    const rows = await sql2`SELECT 1 FROM users WHERE lower(handle) = ${h} LIMIT 1`;
    if (rows.length === 0) return h;
    h = `${root.slice(0, 20)}${n}`;
  }
  return `${root}${randomToken().slice(0, 6)}`;
}
async function createGuestUser() {
  const sql2 = getSql();
  const id = crypto.randomUUID();
  const handle = await uniqueHandle("guest");
  const rows = await sql2`
    INSERT INTO users (id, handle, handle_set, is_guest, is_admin)
    VALUES (${id}, ${handle}, ${true}, ${true}, ${false})
    RETURNING *
  `;
  return rows[0];
}
function publicHandle(user) {
  return user.is_guest ? "guest" : user.handle;
}
async function createSession(userId) {
  const sql2 = getSql();
  const token = randomToken();
  const expires = new Date(Date.now() + DAY);
  await sql2`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expires.toISOString()})`;
  return token;
}
async function userFromToken(token) {
  if (!token) return null;
  const sql2 = getSql();
  const rows = await sql2`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ?? null;
}
async function destroySession(token) {
  if (!token) return;
  const sql2 = getSql();
  await sql2`DELETE FROM sessions WHERE token = ${token}`;
}
async function isAllowlisted(user) {
  if (user.is_admin) return true;
  const sql2 = getSql();
  if (user.github_login) {
    const gh = await sql2`
      SELECT 1 FROM allowlist WHERE lower(github_login) = ${user.github_login.toLowerCase()} LIMIT 1
    `;
    if (gh.length) return true;
  }
  if (user.email) {
    const em = await sql2`
      SELECT 1 FROM allowlist WHERE lower(email) = ${user.email.toLowerCase()} LIMIT 1
    `;
    if (em.length) return true;
  }
  return false;
}
async function upsertGithubUser(profile) {
  const sql2 = getSql();
  const admin = profile.login.toLowerCase() === adminGithubLogin();
  const existing = await sql2`
    SELECT * FROM users WHERE github_id = ${profile.id} LIMIT 1
  `;
  if (existing[0]) {
    if (admin && !existing[0].is_admin) {
      await sql2`UPDATE users SET is_admin = TRUE, github_login = ${profile.login.toLowerCase()} WHERE id = ${existing[0].id}`;
      return { ...existing[0], is_admin: true, github_login: profile.login.toLowerCase() };
    }
    return existing[0];
  }
  const handle = await uniqueHandle(profile.login);
  const id = crypto.randomUUID();
  try {
    const rows = await sql2`
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
    `;
    return rows[0];
  } catch {
    throw new Error("This GitHub account or email is already used with a different login");
  }
}
async function upsertGoogleUser(profile) {
  const sql2 = getSql();
  const existing = await sql2`
    SELECT * FROM users WHERE google_id = ${profile.id} LIMIT 1
  `;
  if (existing[0]) return existing[0];
  const handle = await uniqueHandle(profile.name || profile.email.split("@")[0] || "user");
  const id = crypto.randomUUID();
  try {
    const rows = await sql2`
      INSERT INTO users (id, handle, handle_set, google_id, email, is_admin)
      VALUES (${id}, ${handle}, ${false}, ${profile.id}, ${profile.email.toLowerCase()}, ${false})
      RETURNING *
    `;
    return rows[0];
  } catch {
    throw new Error("This Google account or email is already used with a different login");
  }
}

// src/males.json
var males_default = [
  {
    id: "004",
    age: 30,
    ethnicity: "white",
    lab_mean: 2.7191,
    lab_rank: 24
  },
  {
    id: "005",
    age: 28,
    ethnicity: "east_asian",
    lab_mean: 1.5563,
    lab_rank: 53
  },
  {
    id: "008",
    age: 25,
    ethnicity: "west_asian",
    lab_mean: 2.1313,
    lab_rank: 44
  },
  {
    id: "012",
    age: 24,
    ethnicity: "white",
    lab_mean: 3.1154,
    lab_rank: 13
  },
  {
    id: "017",
    age: 34,
    ethnicity: "white",
    lab_mean: 2.6781,
    lab_rank: 25
  },
  {
    id: "018",
    age: 19,
    ethnicity: "white",
    lab_mean: 3.2523,
    lab_rank: 11
  },
  {
    id: "021",
    age: 48,
    ethnicity: "white",
    lab_mean: 1.893,
    lab_rank: 49
  },
  {
    id: "022",
    age: 29,
    ethnicity: "white",
    lab_mean: 2.9288,
    lab_rank: 17
  },
  {
    id: "024",
    age: 47,
    ethnicity: "east_asian",
    lab_mean: 2.1711,
    lab_rank: 43
  },
  {
    id: "026",
    age: 24,
    ethnicity: "white",
    lab_mean: 2.8492,
    lab_rank: 20
  },
  {
    id: "029",
    age: 26,
    ethnicity: "white",
    lab_mean: 3.3645,
    lab_rank: 8
  },
  {
    id: "031",
    age: null,
    ethnicity: "white",
    lab_mean: 1.9829,
    lab_rank: 47
  },
  {
    id: "033",
    age: 28,
    ethnicity: "white",
    lab_mean: 3.9077,
    lab_rank: 2
  },
  {
    id: "036",
    age: 21,
    ethnicity: "east_asian/white",
    lab_mean: 3.5018,
    lab_rank: 7
  },
  {
    id: "037",
    age: 37,
    ethnicity: "west_asian",
    lab_mean: 3.1858,
    lab_rank: 12
  },
  {
    id: "041",
    age: 29,
    ethnicity: "white",
    lab_mean: 3.6315,
    lab_rank: 4
  },
  {
    id: "042",
    age: 27,
    ethnicity: "black",
    lab_mean: 3.5523,
    lab_rank: 6
  },
  {
    id: "043",
    age: 20,
    ethnicity: "black",
    lab_mean: 2.6096,
    lab_rank: 29
  },
  {
    id: "044",
    age: 22,
    ethnicity: "black",
    lab_mean: 2.7676,
    lab_rank: 22
  },
  {
    id: "045",
    age: 23,
    ethnicity: "east_asian",
    lab_mean: 2.9733,
    lab_rank: 15
  },
  {
    id: "061",
    age: 40,
    ethnicity: "black",
    lab_mean: 2.4087,
    lab_rank: 34
  },
  {
    id: "063",
    age: 19,
    ethnicity: "white",
    lab_mean: 2.8945,
    lab_rank: 19
  },
  {
    id: "067",
    age: 29,
    ethnicity: "east_asian",
    lab_mean: 2.8993,
    lab_rank: 18
  },
  {
    id: "068",
    age: 24,
    ethnicity: "white",
    lab_mean: 2.5698,
    lab_rank: 30
  },
  {
    id: "069",
    age: 21,
    ethnicity: "white",
    lab_mean: 2.4568,
    lab_rank: 32
  },
  {
    id: "070",
    age: 31,
    ethnicity: "west_asian",
    lab_mean: 1.9538,
    lab_rank: 48
  },
  {
    id: "082",
    age: 20,
    ethnicity: "black",
    lab_mean: 3.107,
    lab_rank: 14
  },
  {
    id: "092",
    age: 32,
    ethnicity: "white",
    lab_mean: 2.3892,
    lab_rank: 35
  },
  {
    id: "096",
    age: 23,
    ethnicity: "black",
    lab_mean: 2.7585,
    lab_rank: 23
  },
  {
    id: "101",
    age: 37,
    ethnicity: "white",
    lab_mean: 3.8989,
    lab_rank: 3
  },
  {
    id: "103",
    age: 32,
    ethnicity: "white",
    lab_mean: 2.2579,
    lab_rank: 38
  },
  {
    id: "104",
    age: 22,
    ethnicity: "white",
    lab_mean: 3.5977,
    lab_rank: 5
  },
  {
    id: "105",
    age: 35,
    ethnicity: "white",
    lab_mean: 2.1043,
    lab_rank: 45
  },
  {
    id: "108",
    age: 23,
    ethnicity: "white",
    lab_mean: 3.9228,
    lab_rank: 1
  },
  {
    id: "114",
    age: 24,
    ethnicity: "black",
    lab_mean: 2.5611,
    lab_rank: 31
  },
  {
    id: "115",
    age: 25,
    ethnicity: "west_asian",
    lab_mean: 2.0541,
    lab_rank: 46
  },
  {
    id: "117",
    age: 26,
    ethnicity: "white",
    lab_mean: 2.7967,
    lab_rank: 21
  },
  {
    id: "119",
    age: 39,
    ethnicity: "east_asian",
    lab_mean: 2.2037,
    lab_rank: 41
  },
  {
    id: "121",
    age: 34,
    ethnicity: "white",
    lab_mean: 2.651,
    lab_rank: 27
  },
  {
    id: "123",
    age: 18,
    ethnicity: "white",
    lab_mean: 3.273,
    lab_rank: 9
  },
  {
    id: "125",
    age: 32,
    ethnicity: "white",
    lab_mean: 1.8245,
    lab_rank: 52
  },
  {
    id: "128",
    age: 20,
    ethnicity: "white",
    lab_mean: 2.2029,
    lab_rank: 42
  },
  {
    id: "130",
    age: 19,
    ethnicity: "white",
    lab_mean: 2.2439,
    lab_rank: 39
  },
  {
    id: "131",
    age: 34,
    ethnicity: "white",
    lab_mean: 2.3295,
    lab_rank: 36
  },
  {
    id: "132",
    age: 25,
    ethnicity: "white",
    lab_mean: 2.2634,
    lab_rank: 37
  },
  {
    id: "137",
    age: 21,
    ethnicity: "black",
    lab_mean: 2.9698,
    lab_rank: 16
  },
  {
    id: "138",
    age: 23,
    ethnicity: "white",
    lab_mean: 3.2622,
    lab_rank: 10
  },
  {
    id: "140",
    age: 42,
    ethnicity: "white",
    lab_mean: 2.4246,
    lab_rank: 33
  },
  {
    id: "141",
    age: 23,
    ethnicity: "white",
    lab_mean: 2.6275,
    lab_rank: 28
  },
  {
    id: "142",
    age: 26,
    ethnicity: "west_asian",
    lab_mean: 2.2081,
    lab_rank: 40
  },
  {
    id: "143",
    age: 29,
    ethnicity: "white",
    lab_mean: 1.8834,
    lab_rank: 50
  },
  {
    id: "172",
    age: 40,
    ethnicity: "white",
    lab_mean: 1.8687,
    lab_rank: 51
  },
  {
    id: "173",
    age: 34,
    ethnicity: "white",
    lab_mean: 2.6538,
    lab_rank: 26
  }
];

// src/shots.ts
var SHOTS = [
  { key: "n01", folder: "neutral_left_profile", suffix: "01", label: "L profile", yaw: 0, smiling: false },
  { key: "n02", folder: "neutral_left_3quarter", suffix: "02", label: "L 3/4", yaw: 1, smiling: false },
  { key: "n03", folder: "neutral_front", suffix: "03", label: "Front", yaw: 2, smiling: false },
  { key: "n04", folder: "neutral_right_3quarter", suffix: "04", label: "R 3/4", yaw: 3, smiling: false },
  { key: "n05", folder: "neutral_right_profile", suffix: "05", label: "R profile", yaw: 4, smiling: false },
  { key: "s06", folder: "smiling_left_profile", suffix: "06", label: "Smile L", yaw: 0, smiling: true },
  { key: "s07", folder: "smiling_left_3quarter", suffix: "07", label: "Smile L 3/4", yaw: 1, smiling: true },
  { key: "s08", folder: "smiling_front", suffix: "08", label: "Smile front", yaw: 2, smiling: true },
  { key: "s09", folder: "smiling_right_3quarter", suffix: "09", label: "Smile R 3/4", yaw: 3, smiling: true },
  { key: "s10", folder: "smiling_right_profile", suffix: "10", label: "Smile R", yaw: 4, smiling: true }
];
var FRONT_YAW = 2;
var PROFILE_YAWS = [0, 4];
function yawsFromPhotoKeys(keys) {
  const yaws = /* @__PURE__ */ new Set();
  for (const key of keys) {
    const shot = SHOTS.find((s) => s.key === key);
    if (shot) yaws.add(shot.yaw);
  }
  return [...yaws].sort((a, b) => a - b);
}
function canEnterPool(photoKeys) {
  const yaws = new Set(yawsFromPhotoKeys(photoKeys));
  return yaws.has(FRONT_YAW) && PROFILE_YAWS.some((y) => yaws.has(y));
}
function photoKeysForId(id) {
  return SHOTS.map((s) => `${s.folder}/${id}_${s.suffix}.jpg`);
}

// src/pool.ts
var INITIAL_ELO = 1500;
var londonFaces = males_default.map((m) => ({
  id: m.id,
  source: "london",
  name: m.id,
  age: m.age,
  ethnicity: m.ethnicity,
  labMean: m.lab_mean,
  labRank: m.lab_rank,
  photoKeys: photoKeysForId(m.id)
}));

// src/elo.ts
var K = 32;
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}
function applyWin(winnerElo, loserElo) {
  const pWin = expectedScore(winnerElo, loserElo);
  return {
    winner: winnerElo + K * (1 - pWin),
    loser: loserElo + K * (0 - (1 - pWin))
  };
}

// src/storage.ts
function eloFromVotes(votes, ids) {
  const elo = {};
  for (const id of ids) elo[id] = INITIAL_ELO;
  for (const v of votes) {
    if (!(v.winnerId in elo) || !(v.loserId in elo)) continue;
    const next = applyWin(elo[v.winnerId], elo[v.loserId]);
    elo[v.winnerId] = next.winner;
    elo[v.loserId] = next.loser;
  }
  return elo;
}

// src/percentile.ts
function eloKey(n) {
  return Math.round(n * 1e3) / 1e3;
}
function ranksFromElo(elo, ids) {
  const sorted = [...ids].sort((a, b) => {
    const d = elo[b] - elo[a];
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
  const out = {};
  let i = 0;
  while (i < sorted.length) {
    const key = eloKey(elo[sorted[i]]);
    let j = i + 1;
    while (j < sorted.length && eloKey(elo[sorted[j]]) === key) j++;
    const tied = j - i;
    const rank = i + 1;
    const midRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) {
      out[sorted[k]] = { rank, midRank, tied };
    }
    i = j;
  }
  return out;
}
function beatsPercent(rank, n) {
  if (n <= 0) return 0;
  return (n - rank) / n * 100;
}

// src/tiers.ts
function scoreFromBeatsPct(beatsPct) {
  const p = Math.min(100, Math.max(0, beatsPct));
  let score;
  if (p < 30) score = 1 + p / 30 * 2;
  else if (p < 50) score = 3 + (p - 30) / 20 * 2;
  else if (p < 60) score = 5 + (p - 50) / 10;
  else if (p < 70) score = 6 + (p - 60) / 10;
  else if (p < 80) score = 7 + (p - 70) / 10;
  else if (p < 90) score = 8 + (p - 80) / 10;
  else score = 9 + (p - 90) / 10;
  return Math.min(score, 9.99);
}
function labelFromScore(score) {
  if (score < 3) return "Sub 3";
  if (score < 5) return "Sub 5";
  if (score < 6) return "LTN";
  if (score < 7) return "MTN";
  if (score < 8) return "HTN";
  if (score < 9) return "Chadlite";
  return "Chad";
}
function tierFromBeatsPct(beatsPct) {
  const score = scoreFromBeatsPct(beatsPct);
  return { beatsPct, score, label: labelFromScore(score) };
}

// src/board.ts
function recordById(votes) {
  const rec = {};
  const bump = (id) => {
    if (!rec[id]) rec[id] = { wins: 0, losses: 0 };
  };
  for (const v of votes) {
    bump(v.winnerId);
    bump(v.loserId);
    rec[v.winnerId].wins++;
    rec[v.loserId].losses++;
  }
  return rec;
}
function computeBoard(elo, pool, votes) {
  const rec = recordById(votes);
  const played = (id) => (rec[id]?.wins ?? 0) + (rec[id]?.losses ?? 0);
  const labelsOn = pool.length > 0 && pool.every((f) => played(f.id) > 0);
  const ratedFaces = pool.filter((f) => played(f.id) > 0);
  const rankIds = labelsOn ? pool.map((f) => f.id) : ratedFaces.map((f) => f.id);
  const ranks = ranksFromElo(elo, rankIds);
  const nForPct = pool.length;
  const rated = ratedFaces.map((f) => {
    const info = ranks[f.id];
    let beatsPct = null;
    let score = null;
    let label = null;
    if (labelsOn && info) {
      const tier = tierFromBeatsPct(beatsPercent(info.midRank, nForPct));
      beatsPct = tier.beatsPct;
      score = tier.score;
      label = tier.label;
    }
    return {
      id: f.id,
      name: f.name,
      rank: info?.rank ?? 0,
      elo: elo[f.id] ?? 1500,
      wins: rec[f.id]?.wins ?? 0,
      losses: rec[f.id]?.losses ?? 0,
      matches: played(f.id),
      beatsPct,
      score,
      label,
      labMean: f.labMean,
      labRank: f.labRank,
      source: f.source
    };
  }).sort((a, b) => b.elo - a.elo || a.id.localeCompare(b.id));
  return {
    rated,
    unratedCount: pool.length - ratedFaces.length,
    labelsOn,
    poolSize: pool.length
  };
}

// api/_lib/world.ts
async function loadEnrolled() {
  const sql2 = getSql();
  const faces = await sql2`SELECT id, name FROM enrolled_faces ORDER BY created_at`;
  if (faces.length === 0) return [];
  const photos = await sql2`SELECT face_id, shot_key, data_url FROM enrolled_photos`;
  const by = {};
  for (const p of photos) {
    ;
    (by[p.face_id] ||= {})[p.shot_key] = p.data_url;
  }
  return faces.map((f) => {
    const rec = by[f.id] ?? {};
    return {
      id: f.id,
      source: "user",
      name: f.name,
      age: null,
      ethnicity: "",
      labMean: null,
      labRank: null,
      photoKeys: Object.keys(rec),
      photos: rec
    };
  });
}
function worldPool(enrolled) {
  return [...londonFaces, ...enrolled];
}
async function activeVotes() {
  const sql2 = getSql();
  const rows = await sql2`
    SELECT winner_id, loser_id FROM votes
    WHERE voided_at IS NULL
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((r) => ({ winnerId: r.winner_id, loserId: r.loser_id }));
}
async function buildBoard(enrolled) {
  const pool = worldPool(enrolled);
  const votes = await activeVotes();
  const elo = eloFromVotes(votes, pool.map((f) => f.id));
  const board = computeBoard(elo, pool, votes);
  const rec = recordById(votes);
  const played = {};
  for (const [id, r] of Object.entries(rec)) {
    played[id] = r.wins + r.losses;
  }
  return { pool, votes, board, played, voteCount: votes.length };
}
function poolIds(enrolled) {
  return new Set(worldPool(enrolled).map((f) => f.id));
}
function faceReady(photos) {
  return canEnterPool(Object.keys(photos));
}
function labelFor(id, enrolled) {
  const user = enrolled.find((f) => f.id === id);
  if (user) return user.name;
  return `#${id}`;
}

// api/_lib/app.ts
var app = new Hono().basePath("/api");
function secureCookie(c) {
  return process.env.NODE_ENV === "production" || c.req.url.startsWith("https://");
}
function failRedirect(msg) {
  const u = new URL(appUrl());
  u.searchParams.set("authError", msg);
  return Response.redirect(u.toString(), 302);
}
async function mePayload(user) {
  return {
    id: user.id,
    handle: publicHandle(user),
    handleSet: Boolean(user.handle_set),
    isAdmin: Boolean(user.is_admin),
    isGuest: Boolean(user.is_guest),
    allowlisted: await isAllowlisted(user),
    importedAt: user.imported_at ? new Date(user.imported_at).toISOString() : null,
    githubLogin: user.github_login,
    email: user.email
  };
}
async function ensureVoter(c) {
  const existing = c.get("user");
  if (existing) return existing;
  const user = await createGuestUser();
  const token = await createSession(user.id);
  setCookie(c, sessionCookieName(), token, sessionCookieOpts(secureCookie(c)));
  c.set("user", user);
  return user;
}
app.use("*", async (c, next) => {
  if (c.req.path.endsWith("/health")) {
    await next();
    return;
  }
  try {
    await ensureSchema();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database not configured";
    if (c.req.path.includes("/auth/")) {
      return failRedirect(msg);
    }
    return c.json({ error: msg }, 503);
  }
  const token = getCookie(c, sessionCookieName());
  c.set("user", await userFromToken(token));
  await next();
});
app.get("/health", (c) => c.json({ ok: true }));
app.get("/auth/github", (c) => {
  const state = oauthState();
  setCookie(c, "oauth_state", state, { ...sessionCookieOpts(secureCookie(c)), maxAge: 600 });
  try {
    return c.redirect(githubAuthUrl(state));
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : "GitHub OAuth is not configured");
  }
});
app.get("/auth/google", (c) => {
  const state = oauthState();
  const verifier = pkceVerifier();
  const opts = { ...sessionCookieOpts(secureCookie(c)), maxAge: 600 };
  setCookie(c, "oauth_state", state, opts);
  setCookie(c, "oauth_verifier", verifier, opts);
  try {
    return c.redirect(googleAuthUrl(state, verifier));
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : "Google OAuth is not configured");
  }
});
app.get("/auth/callback/github", async (c) => {
  const expected = getCookie(c, "oauth_state");
  const state = c.req.query("state");
  const code = c.req.query("code");
  deleteCookie(c, "oauth_state", { path: "/" });
  if (!code || !expected || state !== expected) return failRedirect("GitHub login was cancelled or expired");
  try {
    const profile = await githubProfile(code);
    const user = await upsertGithubUser(profile);
    const token = await createSession(user.id);
    setCookie(c, sessionCookieName(), token, sessionCookieOpts(secureCookie(c)));
    return c.redirect(appUrl());
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : "GitHub login failed");
  }
});
app.get("/auth/callback/google", async (c) => {
  const expected = getCookie(c, "oauth_state");
  const verifier = getCookie(c, "oauth_verifier");
  const state = c.req.query("state");
  const code = c.req.query("code");
  deleteCookie(c, "oauth_state", { path: "/" });
  deleteCookie(c, "oauth_verifier", { path: "/" });
  if (!code || !expected || !verifier || state !== expected) {
    return failRedirect("Google login was cancelled or expired");
  }
  try {
    const profile = await googleProfile(code, verifier);
    const user = await upsertGoogleUser(profile);
    const token = await createSession(user.id);
    setCookie(c, sessionCookieName(), token, sessionCookieOpts(secureCookie(c)));
    return c.redirect(appUrl());
  } catch (e) {
    return failRedirect(e instanceof Error ? e.message : "Google login failed");
  }
});
app.post("/auth/logout", async (c) => {
  await destroySession(getCookie(c, sessionCookieName()));
  deleteCookie(c, sessionCookieName(), { path: "/" });
  return c.json({ ok: true });
});
app.get("/state", async (c) => {
  const user = c.get("user");
  const enrolled = await loadEnrolled();
  const { board, played, voteCount } = await buildBoard(enrolled);
  const sql2 = getSql();
  const last = await sql2`
    SELECT id, voter_id FROM votes WHERE voided_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1
  `;
  const lastVote = last[0] ?? null;
  const canUndo = Boolean(user && lastVote && lastVote.voter_id === user.id);
  let allowlist;
  if (user && Boolean(user.is_admin)) {
    const rows = await sql2`SELECT id, github_login, email FROM allowlist ORDER BY created_at`;
    allowlist = rows.map((r) => ({ id: r.id, githubLogin: r.github_login, email: r.email }));
  }
  return c.json({
    me: user ? await mePayload(user) : null,
    enrolled,
    board,
    played,
    voteCount,
    canUndo,
    allowlist: allowlist ?? null
  });
});
app.get("/feed", async (c) => {
  const enrolled = await loadEnrolled();
  const sql2 = getSql();
  const votes = await sql2`
    SELECT v.id, v.winner_id, v.loser_id, v.created_at, v.voided_at, v.void_reason, v.hash, u.handle, u.is_guest
    FROM votes v
    JOIN users u ON u.id = v.voter_id
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT 80
  `;
  const resets = await sql2`
    SELECT r.id, r.created_at, u.handle
    FROM board_resets r
    JOIN users u ON u.id = r.by_user_id
    ORDER BY r.created_at DESC
    LIMIT 20
  `;
  const items = [
    ...votes.map((v) => ({
      kind: "vote",
      id: v.id,
      at: new Date(v.created_at).toISOString(),
      handle: publicHandle(v),
      winner: labelFor(v.winner_id, enrolled),
      loser: labelFor(v.loser_id, enrolled),
      voided: Boolean(v.voided_at),
      voidReason: v.void_reason,
      hash: v.hash
    })),
    ...resets.map((r) => ({
      kind: "reset",
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      handle: r.handle
    }))
  ].sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  return c.json({ items: items.slice(0, 80) });
});
app.post("/me/handle", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Sign in first" }, 401);
  if (Boolean(user.handle_set)) return c.json({ error: "Handle is already set" }, 409);
  const body = await c.req.json();
  const raw = (body.handle || "").trim();
  if (!/^[a-zA-Z0-9_]{2,24}$/.test(raw)) {
    return c.json({ error: "Handle: 2\u201324 letters, numbers, underscore" }, 400);
  }
  const sql2 = getSql();
  const taken = await sql2`SELECT 1 FROM users WHERE lower(handle) = ${raw.toLowerCase()} AND id <> ${user.id} LIMIT 1`;
  if (taken.length) return c.json({ error: "That handle is taken" }, 409);
  await sql2`UPDATE users SET handle = ${raw}, handle_set = TRUE WHERE id = ${user.id}`;
  return c.json({ ok: true, handle: raw });
});
app.post("/votes", async (c) => {
  const user = await ensureVoter(c);
  const body = await c.req.json();
  const winnerId = body.winnerId || "";
  const loserId = body.loserId || "";
  if (!winnerId || !loserId || winnerId === loserId) return c.json({ error: "Pick two different faces" }, 400);
  const enrolled = await loadEnrolled();
  const ids = poolIds(enrolled);
  if (!ids.has(winnerId) || !ids.has(loserId)) return c.json({ error: "Unknown face" }, 400);
  const sql2 = getSql();
  const recent = await sql2`
    SELECT created_at FROM votes WHERE voter_id = ${user.id}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 800) {
    return c.json({ error: "Slow down" }, 429);
  }
  const head = await sql2`
    SELECT hash FROM votes ORDER BY created_at DESC, id DESC LIMIT 1
  `;
  const prev = head[0]?.hash ?? "genesis";
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const hash = voteHash(prev, id, user.id, winnerId, loserId, createdAt);
  await sql2`
    INSERT INTO votes (id, voter_id, winner_id, loser_id, created_at, prev_hash, hash)
    VALUES (${id}, ${user.id}, ${winnerId}, ${loserId}, ${createdAt}, ${prev}, ${hash})
  `;
  return c.json({ ok: true, id, hash });
});
app.post("/votes/undo", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Nothing to undo" }, 409);
  const sql2 = getSql();
  const last = await sql2`
    SELECT id, voter_id FROM votes WHERE voided_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1
  `;
  if (!last[0] || last[0].voter_id !== user.id) {
    return c.json({ error: "Nothing to undo" }, 409);
  }
  await sql2`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${"undo"}
    WHERE id = ${last[0].id} AND voided_at IS NULL
  `;
  return c.json({ ok: true });
});
app.post("/votes/:id/void", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const id = c.req.param("id");
  const sql2 = getSql();
  const rows = await sql2`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${"admin"}
    WHERE id = ${id} AND voided_at IS NULL
    RETURNING id
  `;
  if (!rows.length) return c.json({ error: "Already voided or missing" }, 409);
  return c.json({ ok: true });
});
app.post("/board/wipe", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const sql2 = getSql();
  await sql2`
    UPDATE votes
    SET voided_at = NOW(), voided_by = ${user.id}, void_reason = ${"wipe"}
    WHERE voided_at IS NULL
  `;
  await sql2`INSERT INTO board_resets (id, by_user_id) VALUES (${crypto.randomUUID()}, ${user.id})`;
  return c.json({ ok: true });
});
app.post("/import", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Sign in first" }, 401);
  if (user.imported_at) return c.json({ error: "This account already imported local votes" }, 409);
  if (!await isAllowlisted(user)) return c.json({ error: "You are not on the voter list yet" }, 403);
  const body = await c.req.json();
  const votes = Array.isArray(body.votes) ? body.votes : [];
  const users = Array.isArray(body.users) ? body.users : [];
  const sql2 = getSql();
  if (Boolean(user.is_admin)) {
    for (const u of users) {
      if (!u?.id || !u.photos || !faceReady(u.photos)) continue;
      await sql2`
        INSERT INTO enrolled_faces (id, name, uploaded_by)
        VALUES (${u.id}, ${u.name?.trim() || u.id}, ${user.id})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;
      for (const [key, dataUrl] of Object.entries(u.photos)) {
        if (!SHOTS.some((s) => s.key === key) || typeof dataUrl !== "string") continue;
        await sql2`
          INSERT INTO enrolled_photos (face_id, shot_key, data_url)
          VALUES (${u.id}, ${key}, ${dataUrl})
          ON CONFLICT (face_id, shot_key) DO UPDATE SET data_url = EXCLUDED.data_url
        `;
      }
    }
  }
  const enrolled = await loadEnrolled();
  const ids = poolIds(enrolled);
  let head = await sql2`SELECT hash FROM votes ORDER BY created_at DESC, id DESC LIMIT 1`;
  let prev = head[0]?.hash ?? "genesis";
  let n = 0;
  const t0 = Date.now();
  for (const v of votes) {
    if (!v?.winnerId || !v?.loserId || v.winnerId === v.loserId) continue;
    if (!ids.has(v.winnerId) || !ids.has(v.loserId)) continue;
    const id = crypto.randomUUID();
    const createdAt = new Date(t0 + n).toISOString();
    const hash = voteHash(prev, id, user.id, v.winnerId, v.loserId, createdAt);
    await sql2`
      INSERT INTO votes (id, voter_id, winner_id, loser_id, created_at, prev_hash, hash)
      VALUES (${id}, ${user.id}, ${v.winnerId}, ${v.loserId}, ${createdAt}, ${prev}, ${hash})
    `;
    prev = hash;
    n++;
  }
  await sql2`UPDATE users SET imported_at = NOW() WHERE id = ${user.id}`;
  return c.json({ ok: true, imported: n });
});
app.post("/faces", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const body = await c.req.json();
  const photos = body.photos && typeof body.photos === "object" ? body.photos : {};
  if (!faceReady(photos)) {
    return c.json({ error: "Need Front and one true profile (left or right)" }, 400);
  }
  const id = body.id && /^u-/.test(body.id) ? body.id : `u-${crypto.randomUUID().slice(0, 8)}`;
  const name = (body.name || "").trim() || id;
  const sql2 = getSql();
  await sql2`
    INSERT INTO enrolled_faces (id, name, uploaded_by)
    VALUES (${id}, ${name}, ${user.id})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `;
  await sql2`DELETE FROM enrolled_photos WHERE face_id = ${id}`;
  for (const [key, dataUrl] of Object.entries(photos)) {
    if (!SHOTS.some((s) => s.key === key) || typeof dataUrl !== "string") continue;
    await sql2`
      INSERT INTO enrolled_photos (face_id, shot_key, data_url)
      VALUES (${id}, ${key}, ${dataUrl})
    `;
  }
  return c.json({ ok: true, id });
});
app.delete("/faces/:id", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const id = c.req.param("id");
  const sql2 = getSql();
  const used = await sql2`
    SELECT 1 FROM votes WHERE (winner_id = ${id} OR loser_id = ${id}) AND voided_at IS NULL LIMIT 1
  `;
  if (used.length) return c.json({ error: "Cannot delete after a battle" }, 409);
  await sql2`DELETE FROM enrolled_faces WHERE id = ${id}`;
  return c.json({ ok: true });
});
app.post("/allowlist", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const body = await c.req.json();
  const githubLogin = body.githubLogin?.trim().toLowerCase() || null;
  const email = body.email?.trim().toLowerCase() || null;
  if (!githubLogin && !email) return c.json({ error: "Need a GitHub username or email" }, 400);
  const sql2 = getSql();
  try {
    await sql2`
      INSERT INTO allowlist (id, github_login, email, added_by)
      VALUES (${crypto.randomUUID()}, ${githubLogin}, ${email}, ${user.id})
    `;
  } catch {
    return c.json({ error: "Already on the list" }, 409);
  }
  return c.json({ ok: true });
});
app.delete("/allowlist/:id", async (c) => {
  const user = c.get("user");
  if (!user || !Boolean(user.is_admin)) return c.json({ error: "Admin only" }, 403);
  const sql2 = getSql();
  await sql2`DELETE FROM allowlist WHERE id = ${c.req.param("id")}`;
  return c.json({ ok: true });
});

// api/_lib/vercel.ts
var vercel_default = {
  fetch: (request) => app.fetch(request)
};
export {
  vercel_default as default
};
