export const province = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '330000', name: '浙江省' },
    geometry: { type: 'Polygon', coordinates: [[[118, 27], [122.5, 27], [122.5, 31.5], [118, 31.5], [118, 27]]] },
  }],
}

export const cities = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '330100', name: '杭州市' },
    geometry: { type: 'Polygon', coordinates: [[[119.3, 29.5], [120.7, 29.5], [120.7, 30.7], [119.3, 30.7], [119.3, 29.5]]] },
  }],
}
