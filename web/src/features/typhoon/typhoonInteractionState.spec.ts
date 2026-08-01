import { describe, expect, it } from 'vitest'
import { clearPinnedPopup, hoverPopup, leavePopup, pinPopup, shouldCancelPlaybackForFocus, visiblePopupTarget } from './typhoonInteractionState'

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
})

describe('focus playback policy', () => {
  it('只在切换至不同台风时取消播放', () => {
    expect(shouldCancelPlaybackForFocus('a', 'b')).toBe(true)
    expect(shouldCancelPlaybackForFocus('a', 'a')).toBe(false)
    expect(shouldCancelPlaybackForFocus(null, 'b')).toBe(false)
  })
})
