import type { LevelAggregate, NdviRaster, VillageGrowth, PolicyGrowthRow, AgriTask } from './agriMonitoringTypes'
import { fetchJSON } from '../../api/data'

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
