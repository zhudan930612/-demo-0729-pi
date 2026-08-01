export interface TyphoonPointStyle {
  color: string
  diameterPx: number
  borderColor: '#334155'
  borderWidthPx: 1
  intensityLabel: string
}

const style = (color: string, diameterPx: number, intensityLabel: string): TyphoonPointStyle => ({
  color,
  diameterPx,
  borderColor: '#334155',
  borderWidthPx: 1,
  intensityLabel,
})

export function typhoonPointStyle(windSpeedMs: unknown): TyphoonPointStyle | null {
  if (typeof windSpeedMs !== 'number' || !Number.isFinite(windSpeedMs) || windSpeedMs < 0) return null
  if (windSpeedMs < 17.2) return style('#14B8A6', 5, '热带低压')
  if (windSpeedMs <= 24.4) return style('#3B82F6', 6, '热带风暴')
  if (windSpeedMs >= 24.5 && windSpeedMs <= 32.6) return style('#FACC15', 7, '强热带风暴')
  if (windSpeedMs >= 32.7 && windSpeedMs <= 41.4) return style('#F97316', 8, '台风')
  if (windSpeedMs >= 41.5 && windSpeedMs <= 50.9) return style('#E879F9', 9, '强台风')
  if (windSpeedMs >= 51) return style('#EF4444', 10, '超强台风')
  return null
}
