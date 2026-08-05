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
    geometry: { type: 'Polygon', coordinates: [[[119.5, 28.5], [121, 28.5], [121, 30], [119.5, 30], [119.5, 28.5]]] },
  }],
}

export const counties = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '330101', name: '示例县' },
    geometry: { type: 'Polygon', coordinates: [[[120, 29], [120.5, 29], [120.5, 29.5], [120, 29.5], [120, 29]]] },
  }],
}

export const townships = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '330101001000', name: '示例乡' },
    geometry: { type: 'Polygon', coordinates: [[[120.1, 29.1], [120.4, 29.1], [120.4, 29.4], [120.1, 29.4], [120.1, 29.1]]] },
  }],
}

export const villages = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '330101001001', name: '示例村' },
    geometry: { type: 'Polygon', coordinates: [[[120.15, 29.15], [120.35, 29.15], [120.35, 29.35], [120.15, 29.35], [120.15, 29.15]]] },
  }],
}
