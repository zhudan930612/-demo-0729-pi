import { defineStore } from 'pinia'
import type { Feature } from 'geojson'

export type NavigationGuard = () => boolean
let navigationGuard: NavigationGuard | null = null

export type Level = 'province' | 'city' | 'county' | 'township' | 'village'

export interface Crumb {
  level: Level
  code: string
  name: string
  /** 下钻时被点击要素的几何(用于绘制当前区域轮廓/定位), 不深层响应式 */
  geometry?: Feature['geometry']
}

/** 各级别的子级数据地址; village 无子级 */
export function childrenUrl(crumb: Crumb): string | null {
  switch (crumb.level) {
    case 'province':
      return '/data/boundary/city/330000.geojson'
    case 'city':
      return `/data/boundary/county/${crumb.code}.geojson`
    case 'county':
      return `/data/boundary/township/${crumb.code}.geojson`
    case 'township':
      return `/data/villages/${crumb.code}.geojson`
    default:
      return null
  }
}

export const NEXT_LEVEL: Record<Level, Level | null> = {
  province: 'city',
  city: 'county',
  county: 'township',
  township: 'village',
  village: null,
}

/** 线宽随层级递减(统一主题色, 决策#14) */
export const LEVEL_WEIGHT: Record<Level, number> = {
  province: 3,
  city: 2.5,
  county: 2,
  township: 1.5,
  village: 1.2,
}

export const useDrilldownStore = defineStore('drilldown', {
  state: () => ({
    path: [{ level: 'province', code: '330000', name: '浙江省' }] as Crumb[],
  }),
  getters: {
    current: (s) => s.path[s.path.length - 1],
  },
  actions: {
    setNavigationGuard(guard: NavigationGuard | null) {
      navigationGuard = guard
    },
    canNavigate() {
      return navigationGuard?.() ?? true
    },
    drill(crumb: Crumb) {
      if (this.canNavigate()) this.path.push(crumb)
    },
    backTo(index: number) {
      if (index >= 0 && index < this.path.length - 1 && this.canNavigate()) {
        this.path = this.path.slice(0, index + 1)
      }
    },
    back() {
      if (this.path.length > 1 && this.canNavigate()) this.path.pop()
    },
  },
})
