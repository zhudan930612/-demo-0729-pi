import type L from 'leaflet'
import type { PolicyInsuredMode } from './policyTypes'

export type PolicyBusinessType = '大户' | '团单' | '未参保'

export function policyBusinessType(mode: PolicyInsuredMode | null | undefined): PolicyBusinessType {
  if (mode === 'single_insured') return '大户'
  if (mode === 'insured_roster') return '团单'
  return '未参保'
}

export function linkedParcelStyle(mode: PolicyInsuredMode | null | undefined): L.PathOptions | null {
  if (mode === 'single_insured') {
    return { color: '#16a34a', weight: 3, fillColor: '#4ade80', fillOpacity: 0.25 }
  }
  if (mode === 'insured_roster') {
    return { color: '#8b5cf6', weight: 2.5, dashArray: '7 5', fillColor: '#c4b5fd', fillOpacity: 0.16 }
  }
  return null
}
