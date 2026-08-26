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

/** 按日期预计算的业务聚合（村庄/层级/保单多期/任务多期），前端按选中日期取用。 */
export interface AgriBusiness {
  dates: string[]
  villages: VillageGrowth[][]
  levels: Array<{ byCode: Record<string, LevelAggregate> }>
  policyGrowth: Record<string, PolicyGrowthRow[]>[]
  tasks: AgriTask[][]
}
export const loadAgriBusiness = () => fetchJSON<AgriBusiness>(`${AGRI_DIR}/agri-business.json`)
