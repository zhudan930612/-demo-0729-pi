const cache = new Map<string, Promise<any>>()

export function fetchJSON<T = any>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} -> ${r.status}`)
        return r.json()
      }),
    )
  }
  return cache.get(url)!
}

export interface RsInfo {
  bounds: [number, number, number, number] // [w, s, e, n] EPSG:4326
  minZoom: number
  maxZoom: number
}

export const fetchRsInfo = () => fetchJSON<RsInfo>('/data/rs.json')
