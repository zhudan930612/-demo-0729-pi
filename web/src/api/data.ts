const cache = new Map<string, Promise<unknown>>()

export function fetchJSON<T = unknown>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} -> ${r.status}`)
        return r.json()
      }),
    )
  }
  return cache.get(url)! as Promise<T>
}

export interface RsInfo {
  bounds: [number, number, number, number] // [w, s, e, n] EPSG:4326
  minZoom: number
  maxZoom: number
}

export const fetchRsInfo = () => fetchJSON<RsInfo>('/data/rs.json')
