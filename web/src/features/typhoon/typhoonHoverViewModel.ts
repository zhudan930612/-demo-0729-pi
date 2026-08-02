import { windRadiusPriority } from './typhoonWindCircle'
import type { ObservationNode, TyphoonDetail, WindRadius } from './typhoonTypes'

export type TyphoonHoverTarget =
  | { kind: 'center'; typhoonId: string; nodeId: string }
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

export type TyphoonHoverViewModel = TyphoonCenterHoverViewModel | TyphoonWindHoverViewModel

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
  const node = findNode(detail, target.nodeId)
  if (!detail || !node) return null
  return target.kind === 'center' ? centerModel(detail, node) : windModel(detail, node, target.grade)
}

export function actualNodeSelection(detail: TyphoonDetail | undefined, kind: 'actual' | 'forecast', nodeId: string) {
  if (kind !== 'actual' || !detail?.observationsAsc.some((node) => node.id === nodeId)) return null
  return { typhoonId: detail.id, nodeId, visibleObservationCount: detail.status === 'stop' ? detail.observationsAsc.length : undefined }
}
