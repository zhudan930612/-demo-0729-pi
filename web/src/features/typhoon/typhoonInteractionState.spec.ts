import { describe, expect, it } from 'vitest'
import { clearPinnedPopup, clearPinnedWindPopupOnMove, clearPopupForTyphoon, hoverPopup, leavePopup, pinPopup, visiblePopupTarget } from './typhoonInteractionState'

const center = { kind: 'center' as const, typhoonId: 'a', nodeId: 'n1' }
const wind7 = { kind: 'wind' as const, typhoonId: 'a', nodeId: 'n1', grade: '7' }
const wind10 = { kind: 'wind' as const, typhoonId: 'a', nodeId: 'n1', grade: '10' }

describe('typhoon popup state', () => {
  it('迟到旧风圈 leave 不清除同节点的新 grade popup', () => {
    let state = hoverPopup({ hover: null, pinned: null }, wind10)
    state = leavePopup(state, wind7)
    expect(visiblePopupTarget(state)).toEqual(wind10)
  })
  it('pinned popup 不被 hover leave 清除，地图空白可关闭', () => {
    let state = pinPopup({ hover: center, pinned: null }, wind10)
    state = leavePopup(state, wind10)
    expect(visiblePopupTarget(state)).toEqual(wind10)
    expect(visiblePopupTarget(clearPinnedPopup(state))).toBeNull()
  })
  it('鼠标移动只关闭点击固定的风圈浮窗，不关闭中心浮窗', () => {
    expect(clearPinnedWindPopupOnMove({ hover: null, pinned: wind10 })).toEqual({ hover: null, pinned: null })
    expect(clearPinnedWindPopupOnMove({ hover: null, pinned: center })).toEqual({ hover: null, pinned: center })
  })
  it('关闭历史台风清理自己的 hover/pinned，不影响其他台风 popup', () => {
    const other = { kind: 'center' as const, typhoonId: 'b', nodeId: 'n2' }
    expect(clearPopupForTyphoon({ hover: center, pinned: wind10 }, 'a')).toEqual({ hover: null, pinned: null })
    expect(clearPopupForTyphoon({ hover: other, pinned: wind10 }, 'a')).toEqual({ hover: other, pinned: null })
    const unchanged = { hover: other, pinned: null }
    expect(clearPopupForTyphoon(unchanged, 'a')).toBe(unchanged)
  })
})
