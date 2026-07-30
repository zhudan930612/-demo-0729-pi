import type L from 'leaflet'

export const PARCEL_STYLE: L.PathOptions = {
  color: '#93c5fd',
  weight: 1,
  opacity: 0.95,
  fillColor: '#60a5fa',
  fillOpacity: 0.26,
}

export const PARCEL_EDIT_STYLE: L.PathOptions = {
  color: '#38bdf8',
  weight: 2,
  opacity: 1,
  fillColor: '#0ea5e9',
  fillOpacity: 0.13,
}

export const PARCEL_HOVER_STYLE: L.PathOptions = {
  color: '#f8fafc',
  weight: 4,
  opacity: 1,
  fillColor: '#22d3ee',
  fillOpacity: 0.34,
}

export const PARCEL_PENDING_HIDE_STYLE: L.PathOptions = {
  color: '#fb2c36',
  weight: 3.5,
  opacity: 1,
  fillColor: '#f97316',
  fillOpacity: 0.46,
}

export const PARCEL_HIDDEN_STYLE: L.PathOptions = {
  color: '#fde047',
  weight: 3.5,
  opacity: 1,
  fillColor: '#facc15',
  fillOpacity: 0.18,
  dashArray: '8 4',
}

export const PARCEL_PENDING_RESTORE_STYLE: L.PathOptions = {
  color: '#22c55e',
  weight: 3.5,
  opacity: 1,
  fillColor: '#16a34a',
  fillOpacity: 0.34,
}

export const MANUAL_PARCEL_STYLE: L.PathOptions = {
  color: '#a855f7',
  weight: 2.4,
  opacity: 1,
  fillColor: '#c084fc',
  fillOpacity: 0.24,
}

export const MANUAL_DRAFT_STYLE: L.PathOptions = {
  color: '#e879f9',
  weight: 3,
  opacity: 1,
  fillColor: '#c026d3',
  fillOpacity: 0.25,
  dashArray: '8 5',
}

export const MANUAL_PENDING_STYLE: L.PathOptions = {
  color: '#e879f9',
  weight: 2.6,
  opacity: 1,
  fillColor: '#c026d3',
  fillOpacity: 0.18,
  dashArray: '7 5',
}
