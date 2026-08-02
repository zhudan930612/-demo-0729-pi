import type { ObservationNode, TyphoonDetail, TyphoonId } from './typhoonTypes'

export interface TyphoonNodeRowViewModel {
  id: string
  time: string
  pressure: string
  wind: string
  movementSpeed: string
  selected: boolean
}

export interface TyphoonCardViewModel {
  id: TyphoonId
  number: string
  nameCn: string
  nameEn: string
  status: 'realtime' | 'historical'
  statusLabel: string
  canClose: boolean
  focused: boolean
  expanded: boolean
  selectedNodeId: string | null
  nodes: TyphoonNodeRowViewModel[]
}

export interface TyphoonPathPanelViewModel {
  realtime: TyphoonCardViewModel[]
  historical: TyphoonCardViewModel[]
  cards: TyphoonCardViewModel[]
  displayedCount: number
}

export interface TyphoonPanelSource {
  liveIds: readonly TyphoonId[]
  openedHistoricalIds: readonly TyphoonId[]
  details: Readonly<Record<TyphoonId, TyphoonDetail | undefined>>
  focusedTyphoonId: TyphoonId | null
  expandedIds: readonly TyphoonId[]
  selectedNodeByTyphoon: Readonly<Record<TyphoonId, string | undefined>>
}

const withUnit = (value: number | undefined, unit: string): string => value === undefined ? '--' : `${value}${unit}`

export function compactBeijingTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):\d{2}:\d{2}$/.exec(value)
  return match ? `${match[2]}月${match[3]}日${match[4]}时` : '--'
}

export function typhoonWindText(node: ObservationNode): string {
  const strength = node.intensityText?.trim()
  const speed = Number.isFinite(node.windSpeedMs) ? `${node.windSpeedMs}m/s` : ''
  return strength && speed ? `${strength}（${speed}）` : strength || speed || '--'
}

function displayNumber(detail: TyphoonDetail): string {
  return detail.domesticNo?.trim() || detail.id
}

function cardView(detail: TyphoonDetail, source: TyphoonPanelSource): TyphoonCardViewModel {
  const selectedId = source.selectedNodeByTyphoon[detail.id]
  const selectedNode = (selectedId && detail.observationsAsc.find((node) => node.id === selectedId)) || detail.latestObservation
  const effectiveSelectedId = selectedNode?.id ?? null
  return {
    id: detail.id,
    number: displayNumber(detail),
    nameCn: detail.nameCn || '--',
    nameEn: detail.nameEn || '--',
    status: detail.status === 'start' ? 'realtime' : 'historical',
    statusLabel: detail.status === 'start' ? '实时台风' : '历史台风',
    canClose: detail.status === 'stop',
    focused: source.focusedTyphoonId === detail.id,
    expanded: source.expandedIds.includes(detail.id),
    selectedNodeId: effectiveSelectedId,
    nodes: detail.observationsDesc.map((node) => ({
      id: node.id,
      time: compactBeijingTime(node.timeYmdh),
      pressure: node.pressureHpa === undefined ? '--' : String(node.pressureHpa),
      wind: typhoonWindText(node),
      movementSpeed: withUnit(node.moveSpeedKmh, 'km/h'),
      selected: node.id === effectiveSelectedId,
    })),
  }
}

export function buildTyphoonPathPanelViewModel(source: TyphoonPanelSource): TyphoonPathPanelViewModel {
  const cards = (ids: readonly TyphoonId[]) => ids.flatMap((id) => source.details[id] ? [cardView(source.details[id]!, source)] : [])
  const realtime = cards(source.liveIds)
  const historical = cards(source.openedHistoricalIds)
  return { realtime, historical, cards: [...realtime, ...historical], displayedCount: realtime.length + historical.length }
}
