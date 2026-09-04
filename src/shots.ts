export type Shot = {
  key: string
  folder: string
  suffix: string
  label: string
  yaw: number
  smiling: boolean
}

/** Left profile → front → right profile. Yaw 0 = subject's left, 4 = subject's right. */
export const SHOTS: Shot[] = [
  { key: 'n01', folder: 'neutral_left_profile', suffix: '01', label: 'L profile', yaw: 0, smiling: false },
  { key: 'n02', folder: 'neutral_left_3quarter', suffix: '02', label: 'L 3/4', yaw: 1, smiling: false },
  { key: 'n03', folder: 'neutral_front', suffix: '03', label: 'Front', yaw: 2, smiling: false },
  { key: 'n04', folder: 'neutral_right_3quarter', suffix: '04', label: 'R 3/4', yaw: 3, smiling: false },
  { key: 'n05', folder: 'neutral_right_profile', suffix: '05', label: 'R profile', yaw: 4, smiling: false },
  { key: 's06', folder: 'smiling_left_profile', suffix: '06', label: 'Smile L', yaw: 0, smiling: true },
  { key: 's07', folder: 'smiling_left_3quarter', suffix: '07', label: 'Smile L 3/4', yaw: 1, smiling: true },
  { key: 's08', folder: 'smiling_front', suffix: '08', label: 'Smile front', yaw: 2, smiling: true },
  { key: 's09', folder: 'smiling_right_3quarter', suffix: '09', label: 'Smile R 3/4', yaw: 3, smiling: true },
  { key: 's10', folder: 'smiling_right_profile', suffix: '10', label: 'Smile R', yaw: 4, smiling: true },
]

export const FRONT_YAW = 2
/** L profile, Front, R profile — smile or neutral both count. */
export const REQUIRED_YAWS = [0, 2, 4] as const
export const YAW_LABELS = ['L profile', 'L 3/4', 'Front', 'R 3/4', 'R profile'] as const

export function shotAt(yaw: number, smiling: boolean): Shot {
  const found = SHOTS.find((s) => s.yaw === yaw && s.smiling === smiling)
  if (!found) throw new Error('missing shot')
  return found
}

/** Click left: subject's right (higher yaw). Skips missing angles; stays put at the end. */
export function stepYaw(
  from: number,
  towardSubjectRight: boolean,
  available: number[],
): number {
  const sorted = [...new Set(available)].sort((a, b) => a - b)
  if (towardSubjectRight) {
    const next = sorted.find((y) => y > from)
    return next ?? from
  }
  const lower = sorted.filter((y) => y < from)
  return lower.length ? lower[lower.length - 1] : from
}

export function yawsFromPhotoKeys(keys: Iterable<string>): number[] {
  const yaws = new Set<number>()
  for (const key of keys) {
    const shot = SHOTS.find((s) => s.key === key)
    if (shot) yaws.add(shot.yaw)
  }
  return [...yaws].sort((a, b) => a - b)
}

export function canEnterPool(photoKeys: Iterable<string>): boolean {
  const yaws = new Set(yawsFromPhotoKeys(photoKeys))
  return REQUIRED_YAWS.every((y) => yaws.has(y))
}

export function photoKeysForId(id: string): string[] {
  return SHOTS.map((s) => `${s.folder}/${id}_${s.suffix}.jpg`)
}
