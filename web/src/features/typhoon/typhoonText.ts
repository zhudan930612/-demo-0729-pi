import type { ObservationNode } from './typhoonTypes'

export type TrendSource = 'api' | 'application' | 'none'
export interface TrendText { text: string; source: TrendSource }

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '--'
  return String(value)
}

export function referencePositionText(node: Pick<ObservationNode, 'officialReferenceText'>): string {
  return node.officialReferenceText?.trim() || '暂无参考位置'
}

export function futureTrendText(node: ObservationNode): TrendText {
  const forecastDescription = node.forecastSnapshot?.nodes.find((entry) => entry.forecastDescription)?.forecastDescription
  if (forecastDescription) return { text: forecastDescription, source: 'api' }
  if (node.moveDescription) return { text: node.moveDescription, source: 'application' }
  if (node.moveDirectionText && node.moveSpeedKmh !== undefined) {
    return { text: `将以每小时${node.moveSpeedKmh}公里的速度向${node.moveDirectionText}方向移动`, source: 'application' }
  }
  const firstForecast = node.forecastSnapshot?.nodes[0]
  if (firstForecast) return { text: `已提供未来${firstForecast.forecastHour}小时预测节点`, source: 'application' }
  return { text: '暂无预报信息', source: 'none' }
}
