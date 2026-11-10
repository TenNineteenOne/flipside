/** Snap card swipe (PRD #182 "Snap behaviour details"): past 96px, or a flick past 40px faster than 500px/s. */
export const SWIPE_THRESHOLD = 96
const FLICK_OFFSET = 40
const FLICK_VELOCITY = 500

/** 1 = right ("more like this"), -1 = left ("less like this"), 0 = spring back. */
export function swipeDirection(offsetX: number, velocityX: number): 1 | -1 | 0 {
  if (offsetX > SWIPE_THRESHOLD || (offsetX > FLICK_OFFSET && velocityX > FLICK_VELOCITY)) return 1
  if (offsetX < -SWIPE_THRESHOLD || (offsetX < -FLICK_OFFSET && velocityX < -FLICK_VELOCITY)) return -1
  return 0
}
