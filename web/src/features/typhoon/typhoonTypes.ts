export type TyphoonStatus = 'start' | 'stop'
export type TyphoonId = string

export interface WindRadius {
  grade: string
  gradeText?: string
  gradeDescription?: string
  neRadiusKm: number
  seRadiusKm: number
  swRadiusKm: number
  nwRadiusKm: number
}

export interface ForecastNode {
  id: string
  sourceIndex: number
  forecastHour: number
  lat: number
  lon: number
  windSpeedMs: number
  pressureHpa?: number
  intensityCode?: string
  intensityText?: string
  positionText?: string
  targetTimeYmdh?: string
  forecastDescription?: string
}

export interface ForecastSnapshot {
  observationId: string
  nodes: readonly ForecastNode[]
  maxForecastHour: number
  historicalVersionConfirmed: boolean
}

export interface TyphoonSummary {
  id: TyphoonId
  domesticNo?: string
  internationalNo?: string
  otherNo?: string
  nameCn: string
  nameEn: string
  explanation?: string
  status: TyphoonStatus
  sourceIndex: number
}

export interface ObservationNode {
  id: string
  sourceIndex: number
  timeYmdh: string
  epochMs: number
  lat: number
  lon: number
  windSpeedMs: number
  pressureHpa?: number
  intensityCode?: string
  intensityText?: string
  intensityDescription?: string
  positionText?: string
  moveDirectionCode?: string
  moveDirectionText?: string
  moveSpeedKmh?: number
  moveDescription?: string
  officialReferenceText?: string
  windRadii: readonly WindRadius[]
  forecastSnapshot: ForecastSnapshot | null
}

export interface TyphoonDetail extends TyphoonSummary {
  observationsApiOrder: readonly ObservationNode[]
  observationsAsc: readonly ObservationNode[]
  observationsDesc: readonly ObservationNode[]
  latestObservation: ObservationNode | null
  anomalies: readonly string[]
}

export interface TyphoonSelectionState {
  focusedTyphoonId: TyphoonId | null
  selectedNodeByTyphoon: ReadonlyMap<TyphoonId, string>
  openedHistoricalIds: readonly TyphoonId[]
}
