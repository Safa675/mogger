import { useMemo, useState } from 'react'
import {
  REQUIRED_YAWS,
  SHOTS,
  YAW_LABELS,
  canEnterPool,
  shotAt,
} from './shots'
import { readPhotoFile } from './photos'
import { matchesOf, type StoredUser, type Vote } from './storage'

type Props = {
  users: StoredUser[]
  votes: Vote[]
  onSave: (users: StoredUser[]) => void
}

function emptyPhotos(): Record<string, string> {
  return {}
}

export function UploadPanel({ users, votes, onSave }: Props) {
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
  const editing = editingId ? users.find((u) => u.id === editingId) : null
  const battled = editingId ? matchesOf(editingId, votes) > 0 : false

  function startNew() {
    setEditingId(null)
    setName('')
    setPhotos(emptyPhotos())
    setErr(null)
  }

  function startEdit(u: StoredUser) {
    setEditingId(u.id)
    setName(u.name)
    setPhotos({ ...u.photos })
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

  function clearSlot(key: string, yaw: number) {
    const required = (REQUIRED_YAWS as readonly number[]).includes(yaw)
    if (battled && required) {
      const still = { ...photos }
      delete still[key]
      const other = SHOTS.find((s) => s.yaw === yaw && s.key !== key && still[s.key])
      if (!other) {
        setErr('This angle is required and this face has been in a battle. Replace the photo instead of clearing it.')
        return
      }
    }
    setPhotos((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function save() {
    if (!ready) {
      setErr('Need Front, L profile, and R profile (smile or neutral).')
      return
    }
    if (editingId) {
      onSave(
        users.map((u) =>
          u.id === editingId ? { ...u, name: name.trim() || u.name, photos: { ...photos } } : u,
        ),
      )
    } else {
      const id = `u-${crypto.randomUUID().slice(0, 8)}`
      onSave([...users, { id, name: name.trim() || id, photos: { ...photos } }])
      setEditingId(id)
      if (!name.trim()) setName(id)
    }
    setErr(null)
  }

  function remove(id: string) {
    if (matchesOf(id, votes) > 0) return
    if (!confirm('Remove this upload from the pool?')) return
    onSave(users.filter((u) => u.id !== id))
    if (editingId === id) startNew()
  }

  return (
    <section className="upload">
      <p className="hint">
        Local only. Joins the London pool. Need Front, left profile, and right
        profile — smile or neutral both count. Other angles optional. Can’t
        remove someone after they’ve been in a battle; you can still replace
        photos.
      </p>

      {users.length > 0 ? (
        <ul className="user-list">
          {users.map((u) => {
            const n = matchesOf(u.id, votes)
            const inPool = canEnterPool(Object.keys(u.photos))
            const front = u.photos[shotAt(2, false).key] || u.photos[shotAt(2, true).key]
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
              className={`shot-col-h${(REQUIRED_YAWS as readonly number[]).includes(yaw) ? ' req' : ''}`}
            >
              {label}
              {(REQUIRED_YAWS as readonly number[]).includes(yaw) ? ' *' : ''}
            </div>
          ))}
          {([false, true] as const).map((smiling) => (
            <ShotRow
              key={smiling ? 's' : 'n'}
              smiling={smiling}
              photos={photos}
              covered={covered}
              busy={busy}
              onFile={onFile}
              onClear={clearSlot}
            />
          ))}
        </div>
        <p className="hint">* required angle (either row)</p>
        {err ? <p className="err">{err}</p> : null}
        <button type="button" disabled={!ready || busy} onClick={save}>
          {editing ? 'Save photos' : 'Add to pool'}
        </button>
      </div>
    </section>
  )
}

function ShotRow({
  smiling,
  photos,
  covered,
  busy,
  onFile,
  onClear,
}: {
  smiling: boolean
  photos: Record<string, string>
  covered: Set<number>
  busy: boolean
  onFile: (key: string, file: File | undefined) => void
  onClear: (key: string, yaw: number) => void
}) {
  return (
    <>
      <div className="shot-row-h">{smiling ? 'Smile' : 'Neutral'}</div>
      {[0, 1, 2, 3, 4].map((yaw) => {
        const shot = shotAt(yaw, smiling)
        const src = photos[shot.key]
        const required = (REQUIRED_YAWS as readonly number[]).includes(yaw)
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
                  onClear(shot.key, yaw)
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
