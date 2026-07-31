export type ParcelNumberSource = 'base' | 'manual'

/**
 * 业务展示编号：DK-{12位村代码}-{来源码}-{稳定源ID}。
 *
 * 村代码隔离行政区域，B/M 区分基础与人工地块，稳定源 ID 保证同村内唯一。
 * 该编号只用于展示，不替换 GeoJSON ID 或现有 localStorage 业务键。
 */
export function formatParcelNumber(villageCode: string, source: ParcelNumberSource, sourceId: string): string {
  const village = villageCode.trim()
  const rawId = sourceId.trim()
  if (!/^\d{12}$/.test(village)) throw new Error('地块编号要求 12 位村代码')
  if (!rawId) throw new Error('地块编号要求稳定源 ID')
  const sourceCode = source === 'base' ? 'B' : 'M'
  // 保留稳定源 ID 的原始大小写与前导字符，确保映射为单射；
  // 不做补零、去前缀或大小写归一化，避免不同源 ID 生成同一展示编号。
  return `DK-${village}-${sourceCode}-${rawId}`
}
