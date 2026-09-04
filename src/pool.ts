import males from './males.json'
import { photoKeysForId } from './shots'

export type FaceSource = 'london' | 'user'

export type Face = {
  id: string
  source: FaceSource
  name: string
  age: number | null
  ethnicity: string
  labMean: number | null
  labRank: number | null
  photoKeys: string[]
  /** data URLs keyed by shot.key — only for source "user" */
  photos?: Record<string, string>
}

export const INITIAL_ELO = 1500

export const londonFaces: Face[] = (
  males as Array<{
    id: string
    age: number | null
    ethnicity: string
    lab_mean: number
    lab_rank: number
  }>
).map((m) => ({
  id: m.id,
  source: 'london' as const,
  name: m.id,
  age: m.age,
  ethnicity: m.ethnicity,
  labMean: m.lab_mean,
  labRank: m.lab_rank,
  photoKeys: photoKeysForId(m.id),
}))

export function indexFaces(pool: Face[]): Record<string, Face> {
  return Object.fromEntries(pool.map((f) => [f.id, f]))
}
