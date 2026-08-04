import { nationalAlarmApi, type NationalAlarmApi } from '../../api/nationalAlarms'
import type { NationalAlarmSnapshot } from './nationalAlarmTypes'

export interface NationalAlarmSink { open(): number; begin(refresh?: boolean): number; receive(generation: number, snapshot: NationalAlarmSnapshot): boolean; fail(generation: number, message: string): boolean; beginDetail(id: string, retryAvailable?: boolean): void; receiveDetail(id: string, body: string | null): boolean; failDetail(id: string): boolean; consumeDetailRetry(): void }
function aborted(error: unknown, signal: AbortSignal) { return signal.aborted || (error instanceof Error && error.name === 'AbortError') }
export function createNationalAlarmRepository(sink: NationalAlarmSink, api: NationalAlarmApi = nationalAlarmApi) {
  let listController: AbortController | null = null; let detailController: AbortController | null = null
  async function load(refresh = false, opening = false) { listController?.abort(); const controller = new AbortController(); listController = controller; const generation = opening ? sink.open() : sink.begin(refresh); try { const snapshot = refresh ? await api.refresh(controller.signal) : await api.list(controller.signal); if (listController === controller) sink.receive(generation, snapshot) } catch (error) { if (listController === controller && !aborted(error, controller.signal)) sink.fail(generation, error instanceof Error ? error.message : '浙江预警数据暂不可用') } }
  async function detail(id: string, retry = false) { detailController?.abort(); const controller = new AbortController(); detailController = controller; sink.beginDetail(id, !retry); if (retry) sink.consumeDetailRetry(); try { const result = await api.detail(id, controller.signal); if (detailController === controller) sink.receiveDetail(id, result.body) } catch (error) { if (detailController === controller && !aborted(error, controller.signal)) sink.failDetail(id) } }
  function exit() { listController?.abort(); detailController?.abort(); listController = null; detailController = null }
  return { load, detail, exit }
}
