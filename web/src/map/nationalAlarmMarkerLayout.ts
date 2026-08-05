export const NATIONAL_ALARM_MARKER_WIDTH = 34
export const NATIONAL_ALARM_MARKER_HEIGHT = 26
export const NATIONAL_ALARM_MARKER_GAP = 4

export function groupMarkerOffset(index: number, count: number) {
  return (index - (count - 1) / 2) * (NATIONAL_ALARM_MARKER_WIDTH + NATIONAL_ALARM_MARKER_GAP)
}
