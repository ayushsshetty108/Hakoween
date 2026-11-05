import { useCallback, useEffect, useState } from 'react'
import { getStationWeather, WEATHER_CACHE_MS } from '../services/openMeteo.js'

export function useStationWeather(station) {
  const [state, setState] = useState({ stationId: null, data: null, loading: false, refreshing: false, error: null })

  const refresh = useCallback(async (force = false) => {
    if (!station) return
    setState(current => ({ ...current, stationId: station.id, loading: !current.data, refreshing: true, error: null }))
    try {
      const data = await getStationWeather(station, { force })
      setState({ stationId: station.id, data, loading: false, refreshing: false, error: null })
    } catch (error) {
      setState(current => ({ ...current, stationId: station.id, loading: false, refreshing: false, error }))
    }
  }, [station])

  useEffect(() => {
    if (!station) return
    setState({ stationId: station.id, data: null, loading: true, refreshing: false, error: null })
    refresh(false)
    const timer=window.setInterval(()=>refresh(true),WEATHER_CACHE_MS)
    return()=>window.clearInterval(timer)
  }, [station, refresh])

  const matches = state.stationId === station?.id
  return {
    data: matches ? state.data : null,
    loading: matches ? state.loading : Boolean(station),
    refreshing: matches ? state.refreshing : false,
    error: matches ? state.error : null,
    refresh,
  }
}
