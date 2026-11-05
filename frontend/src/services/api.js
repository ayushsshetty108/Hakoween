const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')
const API_BASE = configuredApiBase && !/^https?:\/\//i.test(configuredApiBase)
  ? `https://${configuredApiBase}`
  : configuredApiBase
const JSON_HEADERS = { Accept: 'application/json' }

export const API_ENDPOINTS = Object.freeze({
  stations: '/api/stations',
  live: '/api/stations/live',
  predictions: '/api/predictions',
  stationWeather: (stationId) => `/api/stations/${encodeURIComponent(stationId)}/weather`,
  stationDischarge: (stationId) => `/api/stations/${encodeURIComponent(stationId)}/discharge`,
  stationPredictions: (stationId) => `/api/predictions/${encodeURIComponent(stationId)}`,
  station: (stationId) => `/api/stations/${encodeURIComponent(stationId)}`,
})

export async function requestJson(path, { signal } = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: JSON_HEADERS, signal })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) throw new Error(`Floodcast API ${path} returned ${response.status}`)
  if (!contentType.includes('json')) throw new Error(`Floodcast API ${path} is not connected`)
  return response.json()
}

export const getApiStations = (options) => requestJson(API_ENDPOINTS.stations, options)
export const getApiLiveStations = (options) => requestJson(API_ENDPOINTS.live, options)
export const getApiPredictions = (options) => requestJson(API_ENDPOINTS.predictions, options)
export const getApiStationWeather = (stationId, options) => requestJson(API_ENDPOINTS.stationWeather(stationId), options)
export const getApiStationDischarge = (stationId, options) => requestJson(API_ENDPOINTS.stationDischarge(stationId), options)
export const getApiStationPredictions = (stationId, options) => requestJson(API_ENDPOINTS.stationPredictions(stationId), options)
export const getApiStation = (stationId, options) => requestJson(API_ENDPOINTS.station(stationId), options)
