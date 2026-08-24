import type { LevelAggregate, NdviRaster, VillageGrowth, PolicyGrowthRow, AgriTask } from './agriMonitoringTypes'
import { fetchJSON } from '../../api/data'

/** 按当前层级过滤任务（R5-6：不同层级查看相应层级任务）。level: province/city/county/township/village */
export function tasksForRegion(
  tasks: AgriTask[],
  villages: VillageGrowth[] | null,
  level: string,
  code: string,
): AgriTask[] {
  return tasks.filter((t) => {
    const v = villages?.find((vv) => vv.code === t.villageCode)
    if (!v) return false
    if (level === 'village') return v.code === code
    if (level === 'township') return v.townshipCode === code
    if (level === 'county') return v.countyCode === code
    if (level === 'city') return v.cityCode === code
    return true // province：全部
  })
}

export const AGRI_DIR = '/data/agri'

export const loadAgriRaster = () => fetchJSON<NdviRaster>(`${AGRI_DIR}/ndvi.json`)
export const loadAgriVillages = () => fetchJSON<VillageGrowth[]>(`${AGRI_DIR}/villages.json`)
export const loadAgriLevels = () =>
  fetchJSON<{ byCode: Record<string, LevelAggregate> }>(`${AGRI_DIR}/levels.json`)
export const loadAgriTasks = () => fetchJSON<AgriTask[]>(`${AGRI_DIR}/tasks.json`)
export const loadAgriPolicyGrowth = (villageCode: string) =>
  fetchJSON<PolicyGrowthRow[]>(`${AGRI_DIR}/policy-growth-${villageCode}.json`)

/** NDVI 值（×100 整数）→ 浮点 NDVI */
export const ndviValue = (v: number): number => v / 100
