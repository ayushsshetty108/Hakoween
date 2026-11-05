import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLiveStationSnapshot, LIVE_REFRESH_MS } from '../services/liveStations.js'

const LiveStationsContext = createContext(null)

export function LiveStationsProvider({ children }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const inProgress = useRef(false)

  const refresh = useCallback(async (force = false) => {
    if (inProgress.current) return
    inProgress.current = true
    setRefreshing(true)
    try {
      const next = await fetchLiveStationSnapshot({ force })
      setSnapshot(next)
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      inProgress.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    refresh()
    const timer = window.setInterval(() => { if (active) refresh(true) }, LIVE_REFRESH_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [refresh])

  const value = useMemo(() => ({ snapshot, loading, refreshing, error, refresh }), [snapshot, loading, refreshing, error, refresh])
  return <LiveStationsContext.Provider value={value}>{children}</LiveStationsContext.Provider>
}

export function useLiveStations() {
  const value = useContext(LiveStationsContext)
  if (!value) throw new Error('useLiveStations must be used inside LiveStationsProvider')
  return value
}
