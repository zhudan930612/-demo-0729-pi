export interface ParcelDetailClickGuard {
  markParcelClick(): void
  consumeMapClick(): boolean
  releaseParcelClick(): void
}

/**
 * Leaflet Canvas may emit a map click after a GeoJSON layer click even when
 * bubblingMouseEvents is disabled. This guard consumes only that same-turn map
 * click; later independent blank-map clicks remain available to close details.
 */
export function createParcelDetailClickGuard(): ParcelDetailClickGuard {
  let pendingParcelClick = false
  return {
    markParcelClick() { pendingParcelClick = true },
    consumeMapClick() {
      if (!pendingParcelClick) return false
      pendingParcelClick = false
      return true
    },
    releaseParcelClick() { pendingParcelClick = false },
  }
}
