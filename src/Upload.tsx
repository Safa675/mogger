import { useMemo, useState } from 'react'
import {
  SHOTS,
  YAW_LABELS,
  blockingYaws,
  canEnterPool,
  shotAt,
} from './shots'
import { readPhotoFile } from './photos'
import { api } from './api'
import type { Face } from './pool'

type Props = {
  faces: Face[]
  played: Record<string, number>
  onRefresh: () => Promise<void>
}

function emptyPhotos(): Record<string, string> {
  return {}
}

export function UploadPanel({ faces, played, onRefresh }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [photos, setPhotos] = useState<Record<string, string>>(emptyPhotos)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const covered = useMemo(() => {
    const y = new Set<number>()
    for (const shot of SHOTS) {
      if (photos[shot.key]) y.add(shot.yaw)
    }
    return y
  }, [photos])

  const ready = canEnterPool(Object.keys(photos))
  const blocking = useMemo(() => blockingYaws(covered), [covered])
  const editing = editingId ? faces.find((u) => u.id === editingId) : null
  const battled = editingId ? (played[editingId] ?? 0) > 0 : false

  function startNew() {
    setEditingId(null)
    setName('')
    setPhotos(emptyPhotos())
    setErr(null)
  }

  function startEdit(u: Face) {
    setEditingId(u.id)
    setName(u.name)
    setPhotos({ ...(u.photos ?? {}) })
    setErr(null)
  }

  async function onFile(key: string, file: File | undefined) {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const data = await readPhotoFile(file)
      setPhotos((prev) => ({ ...prev, [key]: data }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read photo')
    } finally {
      setBusy(false)
    }
  }

  function clearSlot(key: string) {
    const still = { ...photos }
    delete still[key]
    if (battled && !canEnterPool(Object.keys(still))) {
      setErr(
        'This face has been in a battle. Keep Front and at least one profile (left or right). Replace the photo instead of clearing it.',
      )
      return
    }
    setPhotos(still)
    setErr(null)
  }

  async function save() {
    if (!ready) {
      setErr('Need Front and one true profile, left or right (smile or neutral).')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const out = await api<{ id: string }>('/api/faces', {
        method: 'POST',
        body: JSON.stringify({
          id: editingId || undefined,
          name: name.trim(),
          photos,
        }),
      })
      setEditingId(out.id)
      if (!name.trim()) setName(out.id)
      await onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if ((played[id] ?? 0) > 0) return
    if (!confirm('Remove this upload from the pool?')) return
    try {
      await api(`/api/faces/${id}`, { method: 'DELETE' })
      if (editingId === id) startNew()
      await onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
    }
  }

  return (
    <section className="upload">
      <p className="hint">
        Admin only — these faces join the world pool. Need Front and one true
        profile (left or right). Neutral or smile is enough. Cannot remove
        someone after a live battle; you can still replace photos.
      </p>

      {faces.length > 0 ? (
        <ul className="user-list">
          {faces.map((u) => {
            const n = played[u.id] ?? 0
            const inPool = canEnterPool(Object.keys(u.photos ?? {}))
            const front = u.photos?.[shotAt(2, false).key] || u.photos?.[shotAt(2, true).key]
            return (
              <li key={u.id}>
                {front ? <img src={front} alt="" /> : <span className="ph" />}
                <div>
                  <strong>{u.name}</strong>
                  <span>
                    {inPool ? 'in pool' : 'incomplete'} · {n}{' '}
                    {n === 1 ? 'battle' : 'battles'}
                  </span>
                </div>
                <button type="button" onClick={() => startEdit(u)}>
                  Photos
                </button>
                <button
                  type="button"
                  disabled={n > 0}
                  title={n > 0 ? 'Can’t delete after a battle' : 'Remove'}
                  onClick={() => remove(u.id)}
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="hint">No uploads yet.</p>
      )}

      <div className="upload-form">
        <div className="upload-head">
          <h2>{editing ? `Edit ${editing.name}` : 'New face'}</h2>
          {editing ? (
            <button type="button" onClick={startNew}>
              New face
            </button>
          ) : null}
        </div>
        <label className="name-field">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="optional"
          />
        </label>
        <div className="shot-grid">
          <div className="shot-grid-head" />
          {YAW_LABELS.map((label, yaw) => (
            <div
              key={label}
              className={`shot-col-h${blocking.has(yaw) ? ' req' : ''}`}
            >
              {label}
              {blocking.has(yaw) ? ' *' : ''}
            </div>
          ))}
          {([false, true] as const).map((smiling) => (
            <ShotRow
              key={smiling ? 's' : 'n'}
              smiling={smiling}
              photos={photos}
              covered={covered}
              blocking={blocking}
              busy={busy}
              onFile={onFile}
              onClear={clearSlot}
            />
          ))}
        </div>
        <p className="hint">
          * Front is required. L profile and R profile stay marked until you
          add one of those two — not both, and not a 3/4.
        </p>
        {err ? <p className="err">{err}</p> : null}
        <button
          type="button"
          disabled={!ready || busy}
          title={
            ready
              ? undefined
              : 'Add Front and one profile (left or right). Neutral or smile is enough.'
          }
          onClick={() => void save()}
        >
          {ready ? (editing ? 'Save photos' : 'Add to pool') : 'Need Front + one profile'}
        </button>
      </div>
    </section>
  )
}

function ShotRow({
  smiling,
  photos,
  covered,
  blocking,
  busy,
  onFile,
  onClear,
}: {
  smiling: boolean
  photos: Record<string, string>
  covered: Set<number>
  blocking: Set<number>
  busy: boolean
  onFile: (key: string, file: File | undefined) => void
  onClear: (key: string) => void
}) {
  return (
    <>
      <div className="shot-row-h">{smiling ? 'Smile' : 'Neutral'}</div>
      {[0, 1, 2, 3, 4].map((yaw) => {
        const shot = shotAt(yaw, smiling)
        const src = photos[shot.key]
        const required = blocking.has(yaw)
        const yawOk = covered.has(yaw)
        return (
          <label
            key={shot.key}
            className={`slot${src ? ' has' : ''}${required && !yawOk ? ' need' : ''}`}
          >
            {src ? <img src={src} alt={shot.label} /> : <span>{shot.label}</span>}
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                onFile(shot.key, e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {src ? (
              <button
                type="button"
                className="clear"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClear(shot.key)
                }}
              >
                ×
              </button>
            ) : null}
          </label>
        )
      })}
    </>
  )
}
