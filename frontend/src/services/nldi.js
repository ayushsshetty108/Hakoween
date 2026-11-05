const cache = new Map()
const pending = new Map()
const BASE = import.meta.env.DEV ? '/usgs-nldi/linked-data' : 'https://api.water.usgs.gov/nldi/linked-data'

export async function getStationFlowlines(stationId) {
  const key = String(stationId).replace(/^USGS-/, '')
  if (cache.has(key)) return cache.get(key)
  if (pending.has(key)) return pending.get(key)
  const sourceId = `USGS-${key}`
  const urls = [
    `${BASE}/nwissite/${sourceId}/navigation/UM/flowlines?f=json&distance=40&trimStart=true`,
    `${BASE}/nwissite/${sourceId}/navigation/DM/flowlines?f=json&distance=15&trimStart=true`,
  ]
  const request = Promise.all(urls.map(async url => {
    const response = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } })
    if (!response.ok) throw new Error(`USGS NLDI flowlines returned ${response.status}`)
    return response.json()
  })).then(([upstream,downstream])=>{
    const features=[...(upstream.features||[]),...(downstream.features||[])].slice(0,2000)
    if(!features.length)throw new Error('USGS NLDI returned no river reaches for this station.')
    const collection={type:'FeatureCollection',features}
    cache.set(key,collection)
    return collection
  }).finally(()=>pending.delete(key))
  pending.set(key,request)
  return request
}
