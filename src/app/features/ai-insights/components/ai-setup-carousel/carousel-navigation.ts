/** Minimum horizontal travel (px) before a touch counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 40;

export function clampStep(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Next step index for a horizontal swipe, or the same index when the gesture
 * was too short or mostly vertical (the user was scrolling the page).
 */
export function stepAfterSwipe(index: number, count: number, deltaX: number, deltaY: number): number {
  if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) {
    return index;
  }

  return clampStep(deltaX < 0 ? index + 1 : index - 1, count);
}
