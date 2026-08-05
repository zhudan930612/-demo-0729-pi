import { defineStore } from 'pinia'
import type { Level } from '../stores/drilldown'
import type { ModuleError, WeatherMarkerState, WeatherMarkerSummary, WeatherMarkerTarget } from '../features/weather/weatherTypes'

export type WeatherMarkersPhase = 'closed' | 'loading' | 'ready' | 'error'
export interface WeatherMarkerItem {
  code: string
  level: WeatherMarkerTarget['level']
  name: string
  location: { lat: number; lon: number }
  state: WeatherMarkerState
}
export const useWeatherMarkersStore = defineStore('weatherMarkers', {
  state: () => ({
    phase: 'closed' as WeatherMarkersPhase,
    level: null as Level | null,
    code: null as string | null,
    generation: 0,
    order: [] as string[],
    targets: {} as Record<string, WeatherMarkerTarget>,
    markers: {} as Record<string, WeatherMarkerState>,
    errorMessage: '',
  }),
  getters: {
    total: (s) => s.order.length,
    readyCount: (s) => s.order.filter((code) => s.markers[code]?.phase === 'ready').length,
    errorCount: (s) => s.order.filter((code) => s.markers[code]?.phase === 'error').length,
    settledCount: (s) => s.order.filter((code) => s.markers[code] && s.markers[code].phase !== 'loading').length,
    list: (s): WeatherMarkerItem[] => s.order.map((code) => {
      const target = s.targets[code]
      return {
        code,
        level: target?.level ?? 'township',
        name: target?.name ?? code,
        location: target?.location ?? { lat: 0, lon: 0 },
        state: s.markers[code] ?? { phase: 'loading' },
      }
    }),
  },
  actions: {
    begin(level: Level, code: string): number {
      // generation 单调递增且不随 reset 归零，保证旧层级流的迟到事件永远被拒绝。
      this.phase = 'loading'
      this.level = level
      this.code = code
      this.targets = {}
      this.order = []
      this.markers = {}
      this.errorMessage = ''
      this.generation += 1
      return this.generation
    },
    setTargets(generation: number, level: Level, code: string, targets: WeatherMarkerTarget[]): boolean {
      if (generation !== this.generation || level !== this.level || code !== this.code) return false
      const nextTargets: Record<string, WeatherMarkerTarget> = {}
      const order: string[] = []
      for (const target of [...targets].sort((a, b) => a.code.localeCompare(b.code))) {
        nextTargets[target.code] = target
        order.push(target.code)
        if (!this.markers[target.code]) this.markers[target.code] = { phase: 'loading' }
      }
      this.targets = nextTargets
      this.order = order
      this.phase = targets.length === 0 ? 'ready' : 'loading'
      return true
    },
    setReady(generation: number, code: string, summary: WeatherMarkerSummary): boolean {
      if (generation !== this.generation || !this.targets[code]) return false
      this.markers[code] = { phase: 'ready', summary }
      this.refreshPhase()
      return true
    },
    setFail(generation: number, code: string, error: ModuleError): boolean {
      if (generation !== this.generation || !this.targets[code]) return false
      this.markers[code] = { phase: 'error', error }
      this.refreshPhase()
      return true
    },
    setStreamFail(generation: number, error: ModuleError): boolean {
      if (generation !== this.generation) return false
      this.errorMessage = error.message
      this.phase = this.order.length ? this.phase : 'error'
      return true
    },
    refreshPhase() {
      if (this.order.length && this.order.every((code) => this.markers[code] && this.markers[code].phase !== 'loading')) {
        this.phase = 'ready'
      }
    },
    clear() {
      this.phase = 'closed'
      this.level = null
      this.code = null
      this.targets = {}
      this.order = []
      this.markers = {}
      this.errorMessage = ''
      this.generation += 1
    },
  },
})
