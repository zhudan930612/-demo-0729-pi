export const MARKER_SIZE = { width: 84, height: 34 } as const
/** 两个图标之间的最小间隙（像素）。 */
export const MARKER_GAP = 6
/** 避让搜索的最大环数：超过后放弃偏移（保持原锚点，允许极端密集时轻微重叠）。 */
export const MAX_OFFSET_RING = 3

export interface MarkerLayoutInput {
  code: string
  /** 政府驻地锚点的容器坐标（标牌左下角）。 */
  x: number
  y: number
}
export interface MarkerLayoutOutput {
  code: string
  x: number
  y: number
  dx: number
  dy: number
}

function rectOf(x: number, y: number, width: number, height: number): [number, number, number, number] {
  return [x, y - height, x + width, y]
}
function intersects(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

/**
 * 确定性、可逆的屏幕偏移布局：
 * - 输入按稳定行政代码排序，保证同一集合永远产生同一布局；
 * - 每个标牌按 (0,0) -> 上方 -> 下方 -> 左右 的环序尝试候选偏移，
 *   取第一个不与任何已放置标牌重叠的偏移；
 * - 偏移只影响屏幕呈现，不改变实际天气查询坐标（服务器按驻地坐标查询）。
 */
export function layoutMarkers(inputs: MarkerLayoutInput[], size: { width: number; height: number } = MARKER_SIZE): MarkerLayoutOutput[] {
  const sorted = [...inputs].sort((a, b) => a.code.localeCompare(b.code))
  const placed: { rect: [number, number, number, number]; output: MarkerLayoutOutput }[] = []
  const results: MarkerLayoutOutput[] = []
  for (const input of sorted) {
    const step = size.height + MARKER_GAP
    const candidates: [number, number][] = [[0, 0]]
    for (let ring = 1; ring <= MAX_OFFSET_RING; ring++) {
      candidates.push([0, -ring * step])
      candidates.push([0, ring * step])
      candidates.push([-ring * (size.width + MARKER_GAP), 0])
      candidates.push([ring * (size.width + MARKER_GAP), 0])
    }
    let chosen: [number, number] = [0, 0]
    for (const candidate of candidates) {
      const rect = rectOf(input.x + candidate[0], input.y + candidate[1], size.width, size.height)
      if (!placed.some((item) => intersects(item.rect, rect))) {
        chosen = candidate
        break
      }
    }
    const output = { code: input.code, x: input.x + chosen[0], y: input.y + chosen[1], dx: chosen[0], dy: chosen[1] }
    placed.push({ rect: rectOf(output.x, output.y, size.width, size.height), output })
    results.push(output)
  }
  return results
}
