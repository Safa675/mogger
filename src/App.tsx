import { useCallback, useEffect, useMemo, useState } from 'react'
import { londonFaces, indexFaces, type Face } from './pool'
import { FRONT_YAW, YAW_LABELS, shotAt } from './shots'
import {
  canYaw,
  faceUrl,
  hasYaw,
  initialView,
  thumbUrl,
  viewAfterYawClick,
  viewAtYaw,
  type CardView,
} from './media'
import { TIER_LEGEND, type TierLabel } from './tiers'
import { loadSaved } from './storage'
import { UploadPanel } from './Upload'
import { Feed, voidVote } from './Feed'
import { api, loadFeed, loadState, type FeedItem, type Me, type WorldState } from './api'
import { AUTH_SIGNIN_ACTIVE } from './authFlags'
import type { Board } from './board'

type Tab = 'battle' | 'rankings' | 'feed' | 'upload'

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function randomPair(ids: string[], last: [string, string] | null): [string, string] {
  if (ids.length < 2) throw new Error('need two faces')
  for (let i = 0; i < 80; i++) {
    const a = ids[Math.floor(Math.random() * ids.length)]
    let b = ids[Math.floor(Math.random() * ids.length)]
    while (b === a) b = ids[Math.floor(Math.random() * ids.length)]
    if (!last || pairKey(a, b) !== pairKey(last[0], last[1])) return [a, b]
  }
  return [ids[0], ids[1]]
}

function fmtElo(n: number): string {
  return n.toFixed(1)
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

function fmtScore(n: number): string {
  return n.toFixed(2)
}

function labelClass(label: TierLabel): string {
  return `lbl lbl-${label.replace(/\s/g, '').toLowerCase()}`
}

const emptyBoard: Board = { rated: [], unratedCount: 0, labelsOn: false, poolSize: 0 }

export default function App() {
  const [tab, setTab] = useState<Tab>('battle')
  const [err, setErr] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [enrolled, setEnrolled] = useState<Face[]>([])
  const [board, setBoard] = useState<Board>(emptyBoard)
  const [played, setPlayed] = useState<Record<string, number>>({})
  const [voteCount, setVoteCount] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [allowlist, setAllowlist] = useState<WorldState['allowlist']>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [handleDraft, setHandleDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const pool = useMemo(() => [...londonFaces, ...enrolled], [enrolled])
  const ids = useMemo(() => pool.map((f) => f.id), [pool])
  const byId = useMemo(() => indexFaces(pool), [pool])

  const [pair, setPair] = useState<[string, string] | null>(null)
  const [viewLeft, setViewLeft] = useState<CardView>({ yaw: FRONT_YAW, smiling: false })
  const [viewRight, setViewRight] = useState<CardView>({ yaw: FRONT_YAW, smiling: false })

  const applyState = useCallback((s: WorldState) => {
    setMe(s.me)
    setEnrolled(s.enrolled)
    setBoard(s.board)
    setPlayed(s.played)
    setVoteCount(s.voteCount)
    setCanUndo(s.canUndo)
    setAllowlist(s.allowlist)
    if (s.me && AUTH_SIGNIN_ACTIVE && !s.me.isGuest && !s.me.handleSet) setHandleDraft(s.me.handle)
  }, [])

  const refresh = useCallback(async () => {
    const s = await loadState()
    applyState(s)
    if (tab === 'feed') {
      const f = await loadFeed()
      setFeed(f.items)
    }
  }, [applyState, tab])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('authError')
    if (q) {
      setErr(q)
      window.history.replaceState({}, '', window.location.pathname)
    }
    loadState()
      .then(applyState)
      .catch((e) => {
        setErr(e instanceof Error ? e.message : 'Could not reach the server')
      })
  }, [applyState])

  useEffect(() => {
    if (tab !== 'feed') return
    loadFeed()
      .then((f) => setFeed(f.items))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load feed'))
  }, [tab])

  useEffect(() => {
    if (ids.length < 2) {
      setPair(null)
      return
    }
    setPair((cur) => {
      if (cur && ids.includes(cur[0]) && ids.includes(cur[1]) && cur[0] !== cur[1]) return cur
      return randomPair(ids, cur)
    })
  }, [ids])

  const left = pair ? byId[pair[0]] : undefined
  const right = pair ? byId[pair[1]] : undefined

  useEffect(() => {
    if (left) setViewLeft(initialView(left))
    if (right) setViewRight(initialView(right))
  }, [left?.id, right?.id])

  const vote = useCallback(
    async (winnerId: string, loserId: string) => {
      setErr(null)
      try {
        await api('/api/votes', {
          method: 'POST',
          body: JSON.stringify({ winnerId, loserId }),
        })
        await refresh()
        setPair((cur) => (ids.length >= 2 ? randomPair(ids, cur) : null))
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Vote failed')
      }
    },
    [ids, refresh],
  )

  const undo = useCallback(async () => {
    setErr(null)
    try {
      await api('/api/votes/undo', { method: 'POST' })
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Undo failed')
    }
  }, [refresh])

  const wipe = useCallback(async () => {
    if (!confirm('Void every live vote and reset Elo to 1500? Faces stay. This shows up on the public log.')) {
      return
    }
    try {
      await api('/api/board/wipe', { method: 'POST' })
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Wipe failed')
    }
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== 'battle' || !pair) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === '1' || e.key === 'ArrowLeft') {
        e.preventDefault()
        void vote(pair[0], pair[1])
      } else if (e.key === '2' || e.key === 'ArrowRight') {
        e.preventDefault()
        void vote(pair[1], pair[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, pair, vote])

  const userCount = enrolled.length
  const draft = typeof localStorage === 'undefined' ? { votes: [], users: [] } : loadSaved()
  const canImport = Boolean(
    AUTH_SIGNIN_ACTIVE &&
      me &&
      !me.isGuest &&
      !me.importedAt &&
      (draft.votes.length > 0 || draft.users.length > 0),
  )
  const showAuthButtons = AUTH_SIGNIN_ACTIVE && !me
  const showSignedIn = Boolean(me && !me.isGuest)

  async function confirmHandle() {
    setBusy(true)
    setErr(null)
    try {
      await api('/api/me/handle', {
        method: 'POST',
        body: JSON.stringify({ handle: handleDraft.trim() }),
      })
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set handle')
    } finally {
      setBusy(false)
    }
  }

  async function importLocal() {
    if (!confirm(`Publish ${draft.votes.length} local vote(s) as @${me?.handle} on the world board?`)) {
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const out = await api<{ imported: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ votes: draft.votes, users: draft.users }),
      })
      await refresh()
      setErr(out.imported ? `Imported ${out.imported} mogs.` : 'Import finished; no matching faces to write.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function downloadDraft() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'mogger-local.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const parsed = JSON.parse(await file.text()) as { votes?: unknown; users?: unknown }
      const out = await api<{ imported: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ votes: parsed.votes ?? [], users: parsed.users ?? [] }),
      })
      await refresh()
      setErr(out.imported ? `Imported ${out.imported} mogs.` : 'Import finished; no matching faces to write.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    await refresh()
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>mogger</h1>
          <p className="sub">
            v0.01 · {pool.length} in pool ({londonFaces.length} London
            {userCount ? ` + ${userCount} uploaded` : ''}) · world Elo from 1500
          </p>
        </div>
        <div className="header-right">
          <nav>
            <button className={tab === 'battle' ? 'on' : ''} onClick={() => setTab('battle')}>
              Battle
            </button>
            <button className={tab === 'rankings' ? 'on' : ''} onClick={() => setTab('rankings')}>
              Rankings
            </button>
            <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
              Feed
            </button>
            {me?.isAdmin ? (
              <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
                Upload
              </button>
            ) : null}
          </nav>
          <div className="auth">
            {showSignedIn ? (
              <>
                <span>
                  @{me!.handle}
                  {me!.isAdmin ? ' · admin' : ''}
                  {AUTH_SIGNIN_ACTIVE && !me!.allowlisted ? ' · not on voter list' : ''}
                </span>
                <button type="button" onClick={() => void logout()}>
                  Log out
                </button>
              </>
            ) : showAuthButtons ? (
              <>
                <a className="btn-link" href="/api/auth/github">
                  GitHub
                </a>
                <a className="btn-link" href="/api/auth/google">
                  Google
                </a>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {err ? <p className="err">{err}</p> : null}
      {AUTH_SIGNIN_ACTIVE && !me ? (
        <p className="hint">Sign in to vote. Rankings and the mog feed are public. Allowlisted accounts only.</p>
      ) : null}
      {canImport ? (
        <p className="hint import-bar">
          This browser still has {draft.votes.length} local vote(s)
          {draft.users.length ? ` and ${draft.users.length} upload(s)` : ''}.{' '}
          <button type="button" disabled={busy} onClick={() => void importLocal()}>
            Publish as @{me?.handle}
          </button>
          <button type="button" onClick={downloadDraft}>
            Download JSON
          </button>
        </p>
      ) : null}
      {AUTH_SIGNIN_ACTIVE && me && !me.isGuest && !me.importedAt ? (
        <p className="hint import-bar">
          Import mogs from another browser:{' '}
          <label className="btn-link">
            Choose JSON
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                void importFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        </p>
      ) : null}

      {AUTH_SIGNIN_ACTIVE && me && !me.isGuest && !me.handleSet ? (
        <div className="modal">
          <div className="modal-card">
            <h2>Pick your public handle</h2>
            <p className="hint">This name appears on the mog feed. You set it once.</p>
            <input
              value={handleDraft}
              onChange={(e) => setHandleDraft(e.target.value)}
              maxLength={24}
              autoComplete="username"
            />
            <button type="button" disabled={busy} onClick={() => void confirmHandle()}>
              Save handle
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'battle' && left && right ? (
        <Battle
          left={left}
          right={right}
          viewLeft={viewLeft}
          viewRight={viewRight}
          setViewLeft={setViewLeft}
          setViewRight={setViewRight}
          onVote={vote}
          onUndo={undo}
          canUndo={canUndo}
          voteCount={voteCount}
          canVote={AUTH_SIGNIN_ACTIVE ? Boolean(me?.allowlisted && me.handleSet) : true}
        />
      ) : null}
      {tab === 'battle' && (!left || !right) ? (
        <p className="hint">Need at least two faces in the pool to battle.</p>
      ) : null}
      {tab === 'rankings' ? (
        <Rankings board={board} pool={pool} voteCount={voteCount} isAdmin={Boolean(me?.isAdmin)} onWipe={wipe} />
      ) : null}
      {tab === 'feed' ? (
        <Feed
          items={feed}
          isAdmin={Boolean(me?.isAdmin)}
          onVoid={(id) => {
            void voidVote(id)
              .then(() => refresh())
              .catch((e) => setErr(e instanceof Error ? e.message : 'Void failed'))
          }}
        />
      ) : null}
      {tab === 'upload' && me?.isAdmin ? (
        <>
          <Allowlist allowlist={allowlist ?? []} onChange={refresh} />
          <UploadPanel faces={enrolled} played={played} onRefresh={refresh} />
        </>
      ) : null}
    </div>
  )
}

function Allowlist({
  allowlist,
  onChange,
}: {
  allowlist: Array<{ id: string; githubLogin: string | null; email: string | null }>
  onChange: () => Promise<void>
}) {
  const [githubLogin, setGithubLogin] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    setErr(null)
    try {
      await api('/api/allowlist', {
        method: 'POST',
        body: JSON.stringify({
          githubLogin: githubLogin.trim() || undefined,
          email: email.trim() || undefined,
        }),
      })
      setGithubLogin('')
      setEmail('')
      await onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add')
    }
  }

  return (
    <section className="allowlist">
      <h2>Voter list</h2>
      <p className="hint">
        GitHub username or Google email. Unused while voting is open; kept for when sign-in is turned back on.
      </p>
      <ul>
        {allowlist.map((row) => (
          <li key={row.id}>
            {row.githubLogin ? `@${row.githubLogin}` : row.email}
            <button
              type="button"
              onClick={() =>
                void api(`/api/allowlist/${row.id}`, { method: 'DELETE' })
                  .then(onChange)
                  .catch((e) => setErr(e instanceof Error ? e.message : 'Could not remove'))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="allow-form">
        <input
          placeholder="github username"
          value={githubLogin}
          onChange={(e) => setGithubLogin(e.target.value)}
        />
        <input placeholder="google email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="button" onClick={() => void add()}>
          Add voter
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  )
}

function Battle({
  left,
  right,
  viewLeft,
  viewRight,
  setViewLeft,
  setViewRight,
  onVote,
  onUndo,
  canUndo,
  voteCount,
  canVote,
}: {
  left: Face
  right: Face
  viewLeft: CardView
  viewRight: CardView
  setViewLeft: (v: CardView) => void
  setViewRight: (v: CardView) => void
  onVote: (winnerId: string, loserId: string) => void
  onUndo: () => void
  canUndo: boolean
  voteCount: number
  canVote: boolean
}) {
  return (
    <section className="battle">
      <p className="hint">
        Click the face to vote. Keys: 1 / ← left · 2 / → right. ‹ › follow the
        dots (left toward L profile). Neutral / Smile on the card.
        {canVote ? '' : ' Sign in with an allowlisted account to count a mog.'}
      </p>
      <div className="ring">
        <FaceCard
          face={left}
          view={viewLeft}
          onView={setViewLeft}
          onPick={() => canVote && onVote(left.id, right.id)}
          kbd="1"
        />
        <div className="vs">vs</div>
        <FaceCard
          face={right}
          view={viewRight}
          onView={setViewRight}
          onPick={() => canVote && onVote(right.id, left.id)}
          kbd="2"
        />
      </div>
      <div className="bar">
        <span>
          {voteCount} live vote{voteCount === 1 ? '' : 's'}
        </span>
        <button type="button" disabled={!canUndo} onClick={onUndo}>
          Undo last vote
        </button>
      </div>
    </section>
  )
}

function FaceCard({
  face,
  view,
  onView,
  onPick,
  kbd,
}: {
  face: Face
  view: CardView
  onView: (v: CardView) => void
  onPick: () => void
  kbd: string
}) {
  const shot = shotAt(view.yaw, view.smiling)
  const src = faceUrl(face, shot)
  const yaws = [0, 1, 2, 3, 4]
  const canLeft = canYaw(face, view, false)
  const canRight = canYaw(face, view, true)
  const canSmile = hasYaw(face, view.yaw, true)
  const canNeutral = hasYaw(face, view.yaw, false)

  return (
    <article className="card">
      <div className="frame">
        <button type="button" className="pick" onClick={onPick} title={`Vote ${kbd}`}>
          {src ? (
            <img src={src} alt={`${face.name} ${shot.label}`} />
          ) : (
            <span className="missing">No photo</span>
          )}
        </button>
        <button
          type="button"
          className="yaw yaw-l"
          disabled={!canLeft}
          aria-label="Previous angle, toward L profile"
          onClick={(e) => {
            e.stopPropagation()
            onView(viewAfterYawClick(face, view, false))
          }}
        >
          ‹
        </button>
        <button
          type="button"
          className="yaw yaw-r"
          disabled={!canRight}
          aria-label="Next angle, toward R profile"
          onClick={(e) => {
            e.stopPropagation()
            onView(viewAfterYawClick(face, view, true))
          }}
        >
          ›
        </button>
      </div>
      <div className="meta">
        <strong>{face.source === 'user' ? face.name : `#${face.id}`}</strong>
        <span className="src">{face.source}</span>
        <span className="kbd">{kbd}</span>
      </div>
      <div className="shots">
        <span>
          {YAW_LABELS[view.yaw]} · {view.smiling ? 'Smile' : 'Neutral'}
        </span>
        <span className="expr">
          <button
            type="button"
            className={!view.smiling ? 'on' : ''}
            disabled={!canNeutral}
            onClick={() => onView({ ...view, smiling: false })}
          >
            Neutral
          </button>
          <button
            type="button"
            className={view.smiling ? 'on' : ''}
            disabled={!canSmile}
            onClick={() => onView({ ...view, smiling: true })}
          >
            Smile
          </button>
        </span>
      </div>
      <ol className="dots">
        {yaws.map((yaw) => {
          const ok = hasYaw(face, yaw, false) || hasYaw(face, yaw, true)
          return (
            <li key={yaw}>
              <button
                type="button"
                className={yaw === view.yaw ? 'dot on' : 'dot'}
                disabled={!ok}
                onClick={() => onView(viewAtYaw(face, view, yaw))}
                title={YAW_LABELS[yaw]}
                aria-label={YAW_LABELS[yaw]}
              />
            </li>
          )
        })}
      </ol>
    </article>
  )
}

function Rankings({
  board,
  pool,
  voteCount,
  isAdmin,
  onWipe,
}: {
  board: Board
  pool: Face[]
  voteCount: number
  isAdmin: boolean
  onWipe: () => void
}) {
  const [filter, setFilter] = useState<TierLabel | null>(null)
  const rows = board.labelsOn && filter ? board.rated.filter((r) => r.label === filter) : board.rated
  const byId = useMemo(() => indexFaces(pool), [pool])
  const londonFoot = board.rated.filter((r) => r.labMean != null).slice(0, 3)

  return (
    <section className="ranks">
      <p className="hint">
        {board.labelsOn
          ? `Labels on — every face has fought (${board.poolSize} in pool). Sorted by Elo. True Adam is never assigned.`
          : `Labels off until every face has been in at least one battle. Showing Elo and W–L only.`}
      </p>
      <div className="legend">
        {TIER_LEGEND.map((t) => (
          <button
            key={t.label}
            type="button"
            className={`${labelClass(t.label)}${filter === t.label ? ' on' : ''}`}
            disabled={!board.labelsOn}
            title={board.labelsOn ? `Filter ${t.label}` : 'Filters do nothing until labels are on'}
            onClick={() => setFilter((cur) => (cur === t.label ? null : t.label))}
          >
            {t.label} {t.score} · {t.share} of pool
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>id</th>
              <th>Elo</th>
              <th>W–L</th>
              {board.labelsOn ? (
                <>
                  <th>pool %</th>
                  <th>score</th>
                  <th>label</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={board.labelsOn ? 7 : 4}>
                  {board.rated.length === 0 ? 'No battles yet.' : 'No one in this band.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const face = byId[row.id]
                return (
                  <tr key={row.id}>
                    <td>{row.rank}</td>
                    <td className="idcell">
                      {face ? <img src={thumbUrl(face)} alt="" width={36} height={36} /> : null}
                      {row.source === 'user' ? row.name : row.id}
                    </td>
                    <td>{fmtElo(row.elo)}</td>
                    <td>
                      {row.wins}–{row.losses}
                    </td>
                    {board.labelsOn ? (
                      <>
                        <td>{row.beatsPct == null ? '—' : fmtPct(row.beatsPct)}</td>
                        <td>{row.score == null ? '—' : fmtScore(row.score)}</td>
                        <td>
                          {row.label ? <span className={labelClass(row.label)}>{row.label}</span> : '—'}
                        </td>
                      </>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="foot">
        {board.unratedCount} unrated, not listed
        {board.poolSize ? ` · ${board.poolSize} in pool.` : '.'}
      </p>
      {londonFoot.length > 0 ? (
        <p className="foot">
          Lab means (1–7, original London ratings) are not used for Elo.{' '}
          {londonFoot.map((r) => `#${r.id} lab ${r.labMean!.toFixed(2)}`).join(' · ')}
          {board.rated.filter((r) => r.labMean != null).length > 3 ? ' · …' : ''}
        </p>
      ) : null}
      <details className="lab">
        <summary>Show lab mean per London face</summary>
        <ul>
          {londonFaces.map((f) => (
            <li key={f.id}>
              #{f.id} · lab mean {f.labMean?.toFixed(4)} · lab rank {f.labRank}
            </li>
          ))}
        </ul>
      </details>
      <div className="bar">
        <span>
          {voteCount} live vote{voteCount === 1 ? '' : 's'} on the world board
        </span>
        {isAdmin ? (
          <button type="button" onClick={onWipe}>
            Reset ratings
          </button>
        ) : null}
      </div>
    </section>
  )
}
