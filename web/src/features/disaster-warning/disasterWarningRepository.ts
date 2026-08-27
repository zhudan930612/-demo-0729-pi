// 受灾预警静态数据加载：web/public/data/disaster/（ADR-0009 静态固化，运行期零网络依赖）。
import { fetchJSON } from '../../api/data'
import type { DisasterTrack, DisasterPrecip, DisasterWarnings, DisasterWarningData } from './types'

export const DISASTER_DATA_DIR = '/data/disaster'

/**
 * 并发加载受灾预警三份静态产物。
 * 任一加载失败（404/解析错误/结构不完整）即整体失败 → 由 mode 进入 error 态（R2-18 降级）。
 */
export function loadDisasterWarningData(): Promise<DisasterWarningData> {
  return Promise.all([
    fetchJSON<DisasterTrack>(`${DISASTER_DATA_DIR}/track.json`),
    fetchJSON<DisasterPrecip>(`${DISASTER_DATA_DIR}/precip.json`),
    fetchJSON<DisasterWarnings>(`${DISASTER_DATA_DIR}/warnings.json`),
  ]).then(([track, precip, warnings]) => {
    if (!isValidTrack(track)) throw new Error('巴威轨迹数据缺失或格式不正确')
    if (!isValidPrecip(precip)) throw new Error('历史降雨网格数据缺失或格式不正确')
    if (!isValidWarnings(warnings)) throw new Error('预警村清单数据缺失或格式不正确')
    return { track, precip, warnings }
  })
}

export function isValidTrack(track: DisasterTrack | null | undefined): boolean {
  return !!track && Array.isArray(track.datas) && track.datas.length > 0 && track.datas.every((n) => typeof n?.time_ymdh === 'string' && Number.isFinite(n?.lat) && Number.isFinite(n?.lon))
}

export function isValidPrecip(precip: DisasterPrecip | null | undefined): boolean {
  return !!precip
    && Array.isArray(precip.nodeTimes) && precip.nodeTimes.length > 0
    && Array.isArray(precip.grid) && precip.grid.length > 0
    && precip.grid.every((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon) && Array.isArray(g?.cum))
}

export function isValidWarnings(warnings: DisasterWarnings | null | undefined): boolean {
  return !!warnings
    && Array.isArray(warnings.villages)
    && Array.isArray(warnings.nodes)
    && typeof warnings.thresholds?.low === 'number' && typeof warnings.thresholds?.mid === 'number' && typeof warnings.thresholds?.high === 'number'
}
