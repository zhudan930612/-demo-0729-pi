import { describe, expect, it } from 'vitest'
import { adaptTyphoonDetail } from './typhoonAdapter'
import { canOpenHistorical, closeHistoricalTyphoon, createTyphoonSelectionState, displayedTyphoonIds, focusTyphoon, openHistoricalTyphoon, selectTyphoonNode, sortRealtimeTyphoons } from './typhoonSelectors'

function detail(id: string, status: 'start' | 'stop', time: string) {
  return adaptTyphoonDetail({ code: 200, no1: id, type: status, datas: [{ time_ymdh: time, lat: 20, lon: 120, wind_speed_ms: 20 }] })!
}

describe('typhoon selectors and selection state', () => {
  it('覆盖 0/1/多实时并按最新北京时间倒序', () => {
    expect(sortRealtimeTyphoons([])).toEqual([])
    expect(sortRealtimeTyphoons([detail('a', 'start', '2026-01-01 00:00:00')]).map((item) => item.id)).toEqual(['a'])
    expect(sortRealtimeTyphoons([detail('a', 'start', '2026-01-01 00:00:00'), detail('b', 'start', '2026-01-02 00:00:00'), detail('h', 'stop', '2026-01-03 00:00:00')]).map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('列表实时优先，历史严格保持打开顺序', () => {
    expect(displayedTyphoonIds([detail('a', 'start', '2026-01-01 00:00:00')], ['h2', 'h1'])).toEqual(['a', 'h2', 'h1'])
  })

  it('实时 >=6 禁开历史，少于 6 时总数最多 6，实时本身不截断', () => {
    expect(canOpenHistorical(0, 0)).toBe(true)
    expect(canOpenHistorical(5, 0)).toBe(true)
    expect(canOpenHistorical(5, 1)).toBe(false)
    expect(canOpenHistorical(6, 0)).toBe(false)
    expect(canOpenHistorical(7, 0)).toBe(false)
    expect(displayedTyphoonIds(Array.from({ length: 7 }, (_, index) => detail(`r${index}`, 'start', `2026-01-0${index + 1} 00:00:00`)), [])).toHaveLength(7)
  })

  it('关闭重开历史排末尾', () => {
    let state = createTyphoonSelectionState()
    state = openHistoricalTyphoon(state, 'h1', 0)
    state = openHistoricalTyphoon(state, 'h2', 0)
    state = closeHistoricalTyphoon(state, 'h1')
    state = openHistoricalTyphoon(state, 'h1', 0)
    expect(state.openedHistoricalIds).toEqual(['h2', 'h1'])
  })

  it('每台风节点独立，切焦点不清除其他选择', () => {
    let state = createTyphoonSelectionState()
    state = selectTyphoonNode(state, 'a', 'a:obs:1')
    state = selectTyphoonNode(state, 'b', 'b:obs:2')
    state = focusTyphoon(state, 'a')
    expect([...state.selectedNodeByTyphoon]).toEqual([['a', 'a:obs:1'], ['b', 'b:obs:2']])
    expect(state.focusedTyphoonId).toBe('a')
  })
})
