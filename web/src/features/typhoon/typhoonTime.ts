export interface BeijingYearRange {
  year: number
  startMs: number
  endMs: number
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

export function parseBeijingDateTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = DATE_TIME_PATTERN.exec(value)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const epochMs = Date.UTC(year, month - 1, day, hour - 8, minute, second)
  return formatBeijingDateTime(epochMs) === value ? epochMs : null
}

export function formatBeijingDateTime(epochMs: number): string | null {
  if (!Number.isFinite(epochMs)) return null
  const date = new Date(epochMs + BEIJING_OFFSET_MS)
  if (Number.isNaN(date.getTime())) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function beijingDateParts(epochMs: number) {
  const date = new Date(epochMs + BEIJING_OFFSET_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
  }
}

export function beijingYearRange(nowMs: number): BeijingYearRange | null {
  if (!Number.isFinite(nowMs)) return null
  const { year } = beijingDateParts(nowMs)
  return {
    year,
    startMs: Date.UTC(year, 0, 1, -8, 0, 0),
    endMs: nowMs,
  }
}

export function beijingMonthStartMs(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1, -8, 0, 0)
}

export function stableTimeSort<T extends { epochMs: number; sourceIndex: number }>(items: readonly T[], direction: 'asc' | 'desc' = 'asc'): T[] {
  return [...items].sort((left, right) => {
    const timeOrder = direction === 'asc' ? left.epochMs - right.epochMs : right.epochMs - left.epochMs
    return timeOrder || left.sourceIndex - right.sourceIndex
  })
}
