import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Crumb } from '../stores/drilldown'
import type { RsInfo } from '../api/data'

interface ChildLayerOptions {
  collection: FeatureCollection
  style: () => L.PathOptions
  hoverStyle: L.PathOptions
  onSelect(feature: Feature): void
}

export function createMapNavigationController(map: L.Map) {
  let childLayer: L.GeoJSON | null = null
  let outlineLayer: L.GeoJSON | null = null
  let imageryLayer: L.TileLayer | null = null

  const toFeature = (geometry: Geometry | null | undefined): Feature<Geometry | null> => ({
    type: 'Feature',
    properties: {},
    geometry: geometry ?? null,
  })

  function renderOutline(crumb: Crumb, style: L.PathOptions) {
    outlineLayer?.remove()
    outlineLayer = null
    if (!crumb.geometry) return
    outlineLayer = L.geoJSON(toFeature(crumb.geometry), { style, interactive: false }).addTo(map)
  }

  function renderChildren(options: ChildLayerOptions) {
    childLayer?.remove()
    childLayer = L.geoJSON(options.collection, {
      style: options.style,
      onEachFeature: (feature: Feature, layer: L.Layer) => {
        const name = feature.properties?.name ?? ''
        const path = layer as L.Path
        layer.bindTooltip(name, { sticky: true, direction: 'top' })
        layer.on('mouseover', () => {
          path.setStyle(options.hoverStyle)
          path.bringToFront()
        })
        layer.on('mouseout', () => childLayer?.resetStyle(path))
        layer.on('click', () => options.onSelect(feature))
      },
    }).addTo(map)
  }

  function setImagery(info: RsInfo, opacity: number) {
    imageryLayer?.remove()
    imageryLayer = L.tileLayer('/tiles/rs/{z}/{x}/{y}.png', {
      minZoom: info.minZoom,
      maxZoom: info.maxZoom,
      opacity,
      zIndex: 3,
    }).addTo(map)
  }

  function setImageryOpacity(opacity: number) {
    imageryLayer?.setOpacity(opacity)
  }

  function findChildAt(point: [number, number], contains: (point: [number, number], geometry: Geometry | null) => boolean): Feature | null {
    if (!childLayer) return null
    for (const layer of childLayer.getLayers() as L.GeoJSON[]) {
      const feature = layer.feature as Feature | undefined
      if (feature && contains(point, feature.geometry)) return feature
    }
    return null
  }

  function bringOutlineToFront() {
    outlineLayer?.bringToFront()
  }

  function clear() {
    childLayer?.remove()
    outlineLayer?.remove()
    imageryLayer?.remove()
    childLayer = null
    outlineLayer = null
    imageryLayer = null
  }

  function destroy() {
    clear()
  }

  return {
    bringOutlineToFront,
    clear,
    destroy,
    findChildAt,
    renderChildren,
    renderOutline,
    setImagery,
    setImageryOpacity,
  }
}

export type MapNavigationController = ReturnType<typeof createMapNavigationController>
