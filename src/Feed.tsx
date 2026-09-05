import type { FeedItem } from './api'
import { api } from './api'

export function Feed({
  items,
  isAdmin,
  onVoid,
}: {
  items: FeedItem[]
  isAdmin: boolean
  onVoid: (id: string) => void
}) {
  return (
    <section className="feed">
      <p className="hint">
        Public mog log. Newest first. Voided votes stay visible and do not count
        for Elo.
      </p>
      {items.length === 0 ? (
        <p className="hint">No mogs yet.</p>
      ) : (
        <ol className="feed-list">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className={item.kind === 'vote' && item.voided ? 'voided' : ''}>
              {item.kind === 'reset' ? (
                <span>
                  <strong>{item.handle}</strong> reset the board
                </span>
              ) : (
                <span>
                  <strong>{item.handle}</strong>:{' '}
                  {item.voided ? <s>{item.winner} mogged {item.loser}</s> : `${item.winner} mogged ${item.loser}`}
                  {item.voided ? ` · voided${item.voidReason ? ` (${item.voidReason})` : ''}` : ''}
                </span>
              )}
              <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
              {item.kind === 'vote' && isAdmin && !item.voided ? (
                <button type="button" onClick={() => onVoid(item.id)}>
                  Void
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function voidVote(id: string): Promise<{ ok: boolean }> {
  return api(`/api/votes/${id}/void`, { method: 'POST' })
}
