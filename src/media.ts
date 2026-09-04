import type { Face } from './pool'
import {
  FRONT_YAW,
  SHOTS,
  shotAt,
  stepYaw,
  yawsFromPhotoKeys,
  type Shot,
} from './shots'

export type CardView = {
  yaw: number
  smiling: boolean
}

export function faceUrl(face: Face, shot: Shot): string {
  if (face.source === 'user') {
    return face.photos?.[shot.key] || ''
  }
  return `/faces/${shot.folder}/${face.id}_${shot.suffix}.jpg`
}

export function hasShot(face: Face, shot: Shot): boolean {
  if (face.source === 'london') return true
  return Boolean(face.photos?.[shot.key])
}

export function availableYaws(face: Face): number[] {
  if (face.source === 'london') return [0, 1, 2, 3, 4]
  return yawsFromPhotoKeys(Object.keys(face.photos ?? {}))
}

export function hasYaw(face: Face, yaw: number, smiling: boolean): boolean {
  return hasShot(face, shotAt(yaw, smiling))
}

export function thumbUrl(face: Face): string {
  const preferred = [
    shotAt(FRONT_YAW, false),
    shotAt(FRONT_YAW, true),
    ...SHOTS,
  ]
  for (const shot of preferred) {
    if (hasShot(face, shot)) return faceUrl(face, shot)
  }
  return ''
}

export function initialView(face: Face): CardView {
  const yaws = availableYaws(face)
  const yaw = yaws.includes(FRONT_YAW) ? FRONT_YAW : (yaws[0] ?? FRONT_YAW)
  if (hasYaw(face, yaw, false)) return { yaw, smiling: false }
  if (hasYaw(face, yaw, true)) return { yaw, smiling: true }
  return { yaw, smiling: false }
}

export function viewAfterYawClick(
  face: Face,
  view: CardView,
  towardSubjectRight: boolean,
): CardView {
  const nextYaw = stepYaw(view.yaw, towardSubjectRight, availableYaws(face))
  if (nextYaw === view.yaw) return view
  if (hasYaw(face, nextYaw, view.smiling)) return { yaw: nextYaw, smiling: view.smiling }
  if (hasYaw(face, nextYaw, !view.smiling)) {
    return { yaw: nextYaw, smiling: !view.smiling }
  }
  return view
}

export function viewAtYaw(face: Face, view: CardView, yaw: number): CardView {
  if (hasYaw(face, yaw, view.smiling)) return { yaw, smiling: view.smiling }
  if (hasYaw(face, yaw, !view.smiling)) return { yaw, smiling: !view.smiling }
  return view
}

export function canYaw(face: Face, view: CardView, towardSubjectRight: boolean): boolean {
  return viewAfterYawClick(face, view, towardSubjectRight).yaw !== view.yaw
}
