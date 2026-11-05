import { createContext, useContext, useMemo, useState } from 'react'

const WorkspaceStateContext = createContext(null)

export function WorkspaceStateProvider({ children }) {
  const [stationId, setStationId] = useState('01646500')
  const [dateRange, setDateRange] = useState('90')
  const value = useMemo(() => ({ stationId, setStationId, dateRange, setDateRange }), [stationId, dateRange])
  return <WorkspaceStateContext.Provider value={value}>{children}</WorkspaceStateContext.Provider>
}

export function useWorkspaceState() {
  const value = useContext(WorkspaceStateContext)
  if (!value) throw new Error('useWorkspaceState must be used inside WorkspaceStateProvider')
  return value
}
