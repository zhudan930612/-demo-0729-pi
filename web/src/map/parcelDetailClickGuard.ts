export interface ParcelDetailClickGuard {
  markParcelClick(event: Event): void
  consumeMapClick(event: Event): boolean
}

/**
 * Leaflet Canvas may emit a map click after a GeoJSON layer click even when
 * bubblingMouseEvents is disabled. Layer and map events retain the same native
 * event object, so matching by identity is stable even when delivery is delayed.
 */
export function createParcelDetailClickGuard(): ParcelDetailClickGuard {
  let parcelClickEvent: Event | null = null
  return {
    markParcelClick(event) { parcelClickEvent = event },
    consumeMapClick(event) {
      if (event !== parcelClickEvent) return false
      parcelClickEvent = null
      return true
    },
  }
}
