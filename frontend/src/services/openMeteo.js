const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const CACHE_MS = 2 * 60 * 60 * 1000
const cache = new Map()
const pending = new Map()

const HOURLY = [
  'temperature_2m', 'precipitation', 'rain', 'snowfall', 'snow_depth',
  'soil_moisture_0_to_1cm', 'soil_moisture_3_to_9cm',
  'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm',
].join(',')
const DAILY = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'rain_sum', 'snowfall_sum',
].join(',')
const asUtcIso = value => /(?:Z|[+-]\d\d:\d\d)$/.test(String(value)) ? String(value) : `${value}Z`

export async function getStationWeather(station, { force = false, signal } = {}) {
  if (!station || !Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) {
    throw new Error('Weather is unavailable because this station has no valid coordinates.')
  }
  const key = station.id
  if (!force && cache.has(key) && Date.now() - cache.get(key).cachedAt < CACHE_MS) return cache.get(key).data
  if (pending.has(key)) return pending.get(key)

  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', String(station.latitude))
  url.searchParams.set('longitude', String(station.longitude))
  url.searchParams.set('hourly', HOURLY)
  url.searchParams.set('daily', DAILY)
  url.searchParams.set('past_days', '7')
  url.searchParams.set('forecast_days', '7')
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('temperature_unit', 'celsius')
  url.searchParams.set('precipitation_unit', 'mm')

  const request = fetch(url, { headers: { Accept: 'application/json' }, signal })
    .then(async response => {
      if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`)
      const data = await response.json()
      if (!data.hourly?.time?.length && !data.daily?.time?.length) throw new Error('Open-Meteo returned no weather series for this location.')
      if (data.hourly?.time) data.hourly.time = data.hourly.time.map(asUtcIso)
      if (data.daily?.time) data.daily.time = data.daily.time.map(value => String(value).slice(0,10))
      const result = { ...data, stationId: key, fetchedAt: new Date().toISOString(), source: 'Open-Meteo forecast model' }
      cache.set(key, { data: result, cachedAt: Date.now() })
      return result
    })
    .finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export const WEATHER_CACHE_MS = CACHE_MS

export function weatherRows(weather) {
  const hourly = weather?.hourly
  if (!hourly?.time?.length) return []
  return hourly.time.map((time, index) => ({
    time,
    temperature: hourly.temperature_2m?.[index] ?? null,
    precipitation: hourly.precipitation?.[index] ?? null,
    rain: hourly.rain?.[index] ?? null,
    snowfall: hourly.snowfall?.[index] ?? null,
    snowDepth: hourly.snow_depth?.[index] ?? null,
    soil01: hourly.soil_moisture_0_to_1cm?.[index] ?? null,
    soil39: hourly.soil_moisture_3_to_9cm?.[index] ?? null,
    soil927: hourly.soil_moisture_9_to_27cm?.[index] ?? null,
    soil2781: hourly.soil_moisture_27_to_81cm?.[index] ?? null,
  }))
}

export function weatherIsForecast(time, weather, now = Date.now()) {
  const timestamp = Date.parse(time)
  return Number.isFinite(timestamp) && timestamp > now
}
