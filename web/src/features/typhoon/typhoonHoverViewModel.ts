import { windRadiusPriority } from './typhoonWindCircle'
import type { ForecastNode, ObservationNode, TyphoonDetail, WindRadius } from './typhoonTypes'

export type TyphoonHoverTarget =
  | { kind: 'center'; typhoonId: string; nodeId: string }
  | { kind: 'forecast'; typhoonId: string; nodeId: string }
  | { kind: 'wind'; typhoonId: string; nodeId: string; grade: string }

export interface TyphoonCenterHoverViewModel {
  kind: 'center'
  typhoonId: string
  nodeId: string
  nameCn: string
  nameEn: string
  time: string
  position: string
  windSpeed: string
  intensity: string
  pressure: string
  movement: string
  radius7: string
  radius10: string
  radius12: string
}

export interface TyphoonForecastHoverViewModel {
  kind: 'forecast'
  typhoonId: string
  nodeId: string
  title: string
  provider: string
  publishedTime: string
  futureTime: string
  position: string
  windSpeed: string
  pressure: string
  intensity: string
}

export interface TyphoonWindHoverViewModel {
  kind: 'wind'
  typhoonId: string
  nodeId: string
  title: string
  typhoonName: string
  nodeTime: string
  northwest: string
  northeast: string
  southwest: string
  southeast: string
}

export type TyphoonHoverViewModel = TyphoonCenterHoverViewModel | TyphoonForecastHoverViewModel | TyphoonWindHoverViewModel

function findNode(detail: TyphoonDetail | undefined, nodeId: string): ObservationNode | null {
  return detail?.observationsAsc.find((node) => node.id === nodeId) ?? null
}

function radiusText(radius: WindRadius | undefined): string {
  if (!radius) return '--'
  const values = [radius.neRadiusKm, radius.seRadiusKm, radius.swRadiusKm, radius.nwRadiusKm]
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return minimum === maximum ? `${minimum}公里` : `${minimum}-${maximum}公里`
}

function radiusByPriority(node: ObservationNode, priority: number): WindRadius | undefined {
  return node.windRadii.find((radius) => windRadiusPriority(radius) === priority)
}

function compactNodeTime(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/)
  return match ? `${Number(match[2])}月${Number(match[3])}日${match[4]}时` : value || '--'
}

function centerModel(detail: TyphoonDetail, node: ObservationNode): TyphoonCenterHoverViewModel {
  const movement = [node.moveSpeedKmh === undefined ? '' : `${node.moveSpeedKmh}公里/小时`, node.moveDirectionText ?? '']
    .filter(Boolean).join('，') || '--'
  return {
    kind: 'center',
    typhoonId: detail.id,
    nodeId: node.id,
    nameCn: detail.nameCn || '--',
    nameEn: detail.nameEn || '--',
    time: compactNodeTime(node.timeYmdh),
    position: node.positionText?.trim() || `${node.lon.toFixed(2)}° / ${node.lat.toFixed(2)}°`,
    windSpeed: `${node.windSpeedMs}米/秒`,
    intensity: node.intensityText || '--',
    pressure: node.pressureHpa === undefined ? '--' : `${node.pressureHpa}百帕`,
    movement,
    radius7: radiusText(radiusByPriority(node, 1)),
    radius10: radiusText(radiusByPriority(node, 2)),
    radius12: radiusText(radiusByPriority(node, 3)),
  }
}

function findForecast(detail: TyphoonDetail, nodeId: string): { forecast: ForecastNode; origin: ObservationNode } | null {
  for (const origin of detail.observationsAsc) {
    const forecast = origin.forecastSnapshot?.nodes.find((node) => node.id === nodeId)
    if (forecast) return { forecast, origin }
  }
  return null
}

function forecastModel(detail: TyphoonDetail, forecast: ForecastNode, origin: ObservationNode): TyphoonForecastHoverViewModel {
  return {
    kind: 'forecast',
    typhoonId: detail.id,
    nodeId: forecast.id,
    title: `${detail.domesticNo || detail.id} ${detail.nameCn || '--'}`,
    provider: '中国预报',
    publishedTime: compactNodeTime(origin.timeYmdh),
    futureTime: forecast.targetTimeYmdh ? compactNodeTime(forecast.targetTimeYmdh) : `${forecast.forecastHour}小时后`,
    position: forecast.positionText?.trim() || `${forecast.lon.toFixed(2)}° / ${forecast.lat.toFixed(2)}°`,
    windSpeed: `${forecast.windSpeedMs}米/秒`,
    pressure: forecast.pressureHpa === undefined ? '--' : `${forecast.pressureHpa}百帕`,
    intensity: forecast.intensityText || '--',
  }
}

function windModel(detail: TyphoonDetail, node: ObservationNode, grade: string): TyphoonWindHoverViewModel | null {
  const radius = node.windRadii.find((item) => item.grade === grade)
  if (!radius) return null
  return {
    kind: 'wind',
    typhoonId: detail.id,
    nodeId: node.id,
    title: radius.gradeText || `${radius.grade}风圈`,
    typhoonName: `${detail.nameCn || '--'}（${detail.nameEn || '--'}）`,
    nodeTime: node.timeYmdh || '--',
    northwest: `${radius.nwRadiusKm} km`,
    northeast: `${radius.neRadiusKm} km`,
    southwest: `${radius.swRadiusKm} km`,
    southeast: `${radius.seRadiusKm} km`,
  }
}

/** 只按事件携带的台风、节点和风圈标识查询，禁止从全局焦点回退。 */
export function buildTyphoonHoverViewModel(
  details: Readonly<Record<string, TyphoonDetail | undefined>>,
  target: TyphoonHoverTarget,
): TyphoonHoverViewModel | null {
  const detail = details[target.typhoonId]
  if (!detail) return null
  if (target.kind === 'forecast') {
    const found = findForecast(detail, target.nodeId)
    return found ? forecastModel(detail, found.forecast, found.origin) : null
  }
  const node = findNode(detail, target.nodeId)
  if (!node) return null
  return target.kind === 'center' ? centerModel(detail, node) : windModel(detail, node, target.grade)
}

export function actualNodeSelection(detail: TyphoonDetail | undefined, kind: 'actual' | 'forecast', nodeId: string) {
  if (kind !== 'actual' || !detail?.observationsAsc.some((node) => node.id === nodeId)) return null
  return { typhoonId: detail.id, nodeId, visibleObservationCount: detail.status === 'stop' ? detail.observationsAsc.length : undefined }
}
