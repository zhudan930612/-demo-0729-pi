import { typhoonApi, type TyphoonApiClient } from '../../api/typhoon'
import { adaptTyphoonDetail, adaptTyphoonList } from './typhoonAdapter'
import { beijingDateParts } from './typhoonTime'
import type { TyphoonDetail, TyphoonSummary } from './typhoonTypes'

export interface TyphoonSessionSink {
  beginSession(sessionId: number, year: number): void
  isCurrentSession(sessionId: number): boolean
  receiveSummaries(sessionId: number, summaries: readonly TyphoonSummary[]): boolean
  receiveLiveDetail(sessionId: number, detail: TyphoonDetail): boolean
  failLiveDetail(sessionId: number): boolean
  finishLiveLoading(sessionId: number): boolean
  receiveHistoricalDetail(sessionId: number, detail: TyphoonDetail): boolean
  failHistoricalDetail(sessionId: number): boolean
  failList(sessionId: number): boolean
  exitSession(): void
}

export interface TyphoonRepositoryOptions {
  api?: TyphoonApiClient
  now?: () => number
  liveConcurrency?: number
  historyConcurrency?: number
}

export interface TyphoonSessionRepository {
  enter(): Promise<void>
  exit(): void
}

function validConcurrency(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index]!)
    }
  })
  await Promise.all(runners)
}

function detailForSummary(raw: unknown, summary: TyphoonSummary): TyphoonDetail | null {
  const detail = adaptTyphoonDetail(raw)
  if (!detail || detail.id !== summary.id || detail.status !== summary.status || !detail.latestObservation) return null
  return {
    ...detail,
    domesticNo: summary.domesticNo,
    internationalNo: summary.internationalNo,
    otherNo: summary.otherNo,
    nameCn: summary.nameCn || detail.nameCn,
    nameEn: summary.nameEn || detail.nameEn,
    explanation: summary.explanation ?? detail.explanation,
    sourceIndex: summary.sourceIndex,
  }
}

function aborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')
}

export function createTyphoonSessionRepository(store: TyphoonSessionSink, options: TyphoonRepositoryOptions = {}): TyphoonSessionRepository {
  const api = options.api ?? typhoonApi
  const now = options.now ?? Date.now
  const liveConcurrency = validConcurrency(options.liveConcurrency, 3)
  const historyConcurrency = validConcurrency(options.historyConcurrency, 3)
  let generation = 0
  let active: { id: number; controller: AbortController; promise: Promise<void> } | null = null

  async function load(sessionId: number, controller: AbortController) {
    const signal = controller.signal
    const current = () => !signal.aborted && active?.id === sessionId && store.isCurrentSession(sessionId)
    const year = beijingDateParts(now()).year
    store.beginSession(sessionId, year)
    let listRaw: unknown
    try {
      listRaw = await api.list(year, signal)
    } catch (error) {
      if (!aborted(error, signal) && current()) store.failList(sessionId)
      return
    }
    if (!current()) return
    const listResult = adaptTyphoonList(listRaw)
    if (listResult.anomalies.includes('台风列表结构无效')) {
      store.failList(sessionId)
      return
    }
    store.receiveSummaries(sessionId, listResult.summaries)
    const live = listResult.summaries.filter((summary) => summary.status === 'start')
    const historical = listResult.summaries.filter((summary) => summary.status === 'stop')

    await runPool(live, liveConcurrency, async (summary) => {
      try {
        const raw = await api.detail(summary.id, signal)
        if (!current()) return
        const detail = detailForSummary(raw, summary)
        if (detail) store.receiveLiveDetail(sessionId, detail)
        else store.failLiveDetail(sessionId)
      } catch (error) {
        if (!aborted(error, signal) && current()) store.failLiveDetail(sessionId)
      }
    })
    if (!current()) return
    store.finishLiveLoading(sessionId)

    await runPool(historical, historyConcurrency, async (summary) => {
      try {
        const raw = await api.detail(summary.id, signal)
        if (!current()) return
        const detail = detailForSummary(raw, summary)
        if (detail) store.receiveHistoricalDetail(sessionId, detail)
        else store.failHistoricalDetail(sessionId)
      } catch (error) {
        if (!aborted(error, signal) && current()) store.failHistoricalDetail(sessionId)
      }
    })
  }

  return {
    enter() {
      if (active) return active.promise
      const id = ++generation
      const controller = new AbortController()
      const promise = load(id, controller)
      active = { id, controller, promise }
      return promise
    },
    exit() {
      generation += 1
      active?.controller.abort()
      active = null
      store.exitSession()
    },
  }
}
