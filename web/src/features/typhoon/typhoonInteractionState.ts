import type { TyphoonHoverTarget } from './typhoonHoverViewModel'

export interface TyphoonPopupState {
  hover: TyphoonHoverTarget | null
  pinned: TyphoonHoverTarget | null
}

export function sameHoverTarget(left: TyphoonHoverTarget | null, right: TyphoonHoverTarget | null): boolean {
  if (!left || !right || left.kind !== right.kind || left.typhoonId !== right.typhoonId || left.nodeId !== right.nodeId) return false
  return left.kind === 'center' || (right.kind === 'wind' && left.grade === right.grade)
}
export function visiblePopupTarget(state: TyphoonPopupState): TyphoonHoverTarget | null { return state.pinned ?? state.hover }
export function hoverPopup(state: TyphoonPopupState, target: TyphoonHoverTarget): TyphoonPopupState { return { ...state, hover: target } }
export function leavePopup(state: TyphoonPopupState, target: TyphoonHoverTarget): TyphoonPopupState { return sameHoverTarget(state.hover, target) ? { ...state, hover: null } : state }
export function pinPopup(_state: TyphoonPopupState, target: TyphoonHoverTarget): TyphoonPopupState { return { hover: null, pinned: target } }
export function clearPinnedPopup(state: TyphoonPopupState): TyphoonPopupState { return { ...state, pinned: null } }

/** 切换不同台风前取消动画；相同台风的展开/详情操作不误停自己的播放。 */
export function shouldCancelPlaybackForFocus(activePlaybackId: string | null, nextTyphoonId: string): boolean {
  return activePlaybackId !== null && activePlaybackId !== nextTyphoonId
}
