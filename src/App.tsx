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
import { computeBoard } from './board'
import { TIER_LEGEND, type TierLabel } from './tiers'
import {
  activePool,
  eloFromVotes,
  loadSaved,
  persistSaved,
  type StoredUser,
  type Vote,
} from './storage'
import { UploadPanel } from './Upload'

type Tab = 'battle' | 'rankings' | 'upload'

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

const saved0 = loadSaved()

export default function App() {
  const [tab, setTab] = useState<Tab>('battle')
  const [votes, setVotes] = useState<Vote[]>(() => saved0.votes)
  const [users, setUsers] = useState<StoredUser[]>(() => saved0.users)
  const pool = useMemo(() => activePool(users), [users])
  const ids = useMemo(() => pool.map((f) => f.id), [pool])
  const byId = useMemo(() => indexFaces(pool), [pool])

  const [pair, setPair] = useState<[string, string] | null>(() =>
    ids.length >= 2 ? randomPair(ids, null) : null,
  )
  const [viewLeft, setViewLeft] = useState<CardView>({ yaw: FRONT_YAW, smiling: false })
  const [viewRight, setViewRight] = useState<CardView>({ yaw: FRONT_YAW, smiling: false })

  const elo = useMemo(() => eloFromVotes(votes, ids), [votes, ids])
  const board = useMemo(() => computeBoard(elo, pool, votes), [elo, pool, votes])

  useEffect(() => {
    try {
      persistSaved({ votes, users })
    } catch {
      alert('Could not save (browser storage full). Try fewer or smaller photos.')
    }
  }, [votes, users])

  useEffect(() => {
    if (ids.length < 2) {
      setPair(null)
      return
    }
    setPair((cur) => {
      if (cur && ids.includes(cur[0]) && ids.includes(cur[1]) && cur[0] !== cur[1]) {
        return cur
      }
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
    (winnerId: string, loserId: string) => {
      setVotes((prev) => [...prev, { winnerId, loserId }])
      setPair((cur) => (ids.length >= 2 ? randomPair(ids, cur) : null))
    },
    [ids],
  )

  const undo = useCallback(() => {
    setVotes((prev) => prev.slice(0, -1))
  }, [])

  const resetVotes = useCallback(() => {
    if (!confirm('Clear all votes and reset Elo to 1500? Uploads stay.')) return
    setVotes([])
    if (ids.length >= 2) setPair(randomPair(ids, null))
  }, [ids])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== 'battle' || !pair) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        return
      }
      if (e.key === '1' || e.key === 'ArrowLeft') {
        e.preventDefault()
        vote(pair[0], pair[1])
      } else if (e.key === '2' || e.key === 'ArrowRight') {
        e.preventDefault()
        vote(pair[1], pair[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, pair, vote])

  const userCount = pool.filter((f) => f.source === 'user').length

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>mogger</h1>
          <p className="sub">
            v0.01 · {pool.length} in pool ({londonFaces.length} London
            {userCount ? ` + ${userCount} uploaded` : ''}) · Elo starts at 1500
          </p>
        </div>
        <nav>
          <button className={tab === 'battle' ? 'on' : ''} onClick={() => setTab('battle')}>
            Battle
          </button>
          <button
            className={tab === 'rankings' ? 'on' : ''}
            onClick={() => setTab('rankings')}
          >
            Rankings
          </button>
          <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
            Upload
          </button>
        </nav>
      </header>

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
          canUndo={votes.length > 0}
          voteCount={votes.length}
        />
      ) : null}
      {tab === 'battle' && (!left || !right) ? (
        <p className="hint">Need at least two faces in the pool to battle.</p>
      ) : null}
      {tab === 'rankings' ? (
        <Rankings
          board={board}
          pool={pool}
          voteCount={votes.length}
          onReset={resetVotes}
        />
      ) : null}
      {tab === 'upload' ? (
        <UploadPanel
          users={users}
          votes={votes}
          onSave={setUsers}
        />
      ) : null}
    </div>
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
}) {
  return (
    <section className="battle">
      <p className="hint">
        Click the face to vote. Keys: 1 / ← left · 2 / → right. ‹ › rotate the
        head (left = subject’s right). Neutral / Smile on the card.
      </p>
      <div className="ring">
        <FaceCard
          face={left}
          view={viewLeft}
          onView={setViewLeft}
          onPick={() => onVote(left.id, right.id)}
          kbd="1"
        />
        <div className="vs">vs</div>
        <FaceCard
          face={right}
          view={viewRight}
          onView={setViewRight}
          onPick={() => onVote(right.id, left.id)}
          kbd="2"
        />
      </div>
      <div className="bar">
        <span>
          {voteCount} vote{voteCount === 1 ? '' : 's'}
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
  const canLeft = canYaw(face, view, true)
  const canRight = canYaw(face, view, false)
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
          aria-label="Turn so subject's right is visible"
          onClick={(e) => {
            e.stopPropagation()
            onView(viewAfterYawClick(face, view, true))
          }}
        >
          ‹
        </button>
        <button
          type="button"
          className="yaw yaw-r"
          disabled={!canRight}
          aria-label="Turn so subject's left is visible"
          onClick={(e) => {
            e.stopPropagation()
            onView(viewAfterYawClick(face, view, false))
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
  onReset,
}: {
  board: ReturnType<typeof computeBoard>
  pool: Face[]
  voteCount: number
  onReset: () => void
}) {
  const [filter, setFilter] = useState<TierLabel | null>(null)
  const rows = board.labelsOn && filter
    ? board.rated.filter((r) => r.label === filter)
    : board.rated
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
            title={
              board.labelsOn
                ? `Filter ${t.label}`
                : 'Filters do nothing until labels are on'
            }
            onClick={() =>
              setFilter((cur) => (cur === t.label ? null : t.label))
            }
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
                  {board.rated.length === 0
                    ? 'No battles yet.'
                    : 'No one in this band.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const face = byId[row.id]
                return (
                  <tr key={row.id}>
                    <td>{row.rank}</td>
                    <td className="idcell">
                      {face ? (
                        <img src={thumbUrl(face)} alt="" width={36} height={36} />
                      ) : null}
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
                          {row.label ? (
                            <span className={labelClass(row.label)}>{row.label}</span>
                          ) : (
                            '—'
                          )}
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
          {londonFoot
            .map((r) => `#${r.id} lab ${r.labMean!.toFixed(2)}`)
            .join(' · ')}
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
          {voteCount} vote{voteCount === 1 ? '' : 's'} stored locally
        </span>
        <button type="button" onClick={onReset}>
          Reset ratings
        </button>
      </div>
    </section>
  )
}
