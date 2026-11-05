import { useMemo } from 'react'
import { AlertTriangle, BellRing, ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, StatusChip, formatValue } from '../components.jsx'
import WorkspaceTable from '../components/WorkspaceTable.jsx'
import { useData } from '../hooks/useData.js'
import { useLiveStations } from '../hooks/LiveStationsContext.jsx'
import { getStations } from '../services/data.js'

export default function FloodAlerts() {
  const { data: stations, error, loading } = useData(getStations, 'flood-alert-stations')
  const { snapshot, loading: liveLoading, error: liveError, refresh, refreshing } = useLiveStations()
  const rows = useMemo(() => {
    if (!snapshot) return []
    const metadata = new Map((stations || []).map(site => [site.id, site]))
    const result = []
    for (const item of snapshot.stations || []) {
      const site = metadata.get(item.stationId)
      const classification = item.risk?.classification
      const source = item.risk?.thresholdSource
      const threshold = Number(item.risk?.thresholdValue)
      const observed = Number(item.streamflow?.value)
      const validThreshold = source && Number.isFinite(threshold)
      const thresholdReached = validThreshold && item.streamflow?.value != null && Number.isFinite(observed) && observed >= threshold
      if (classification && source) result.push({
        id: `${item.stationId}-risk`, station_id: item.stationId, station_name: site?.river || item.stationId,
        category: classification.toUpperCase(), status: 'Backend classification', observed: item.streamflow?.value,
        threshold: item.risk.thresholdValue, threshold_source: source, date: item.streamflow?.time || 'Unavailable',
      })
      if (thresholdReached) result.push({
        id: `${item.stationId}-threshold`, station_id: item.stationId, station_name: site?.river || item.stationId,
        category: 'THRESHOLD EXCEEDED', status: 'Verified threshold comparison', observed: item.streamflow.value,
        threshold, threshold_source: source, date: item.streamflow?.time || 'Unavailable',
      })
      for (const alert of item.alerts || []) {
        if (alert.active !== true) continue
        result.push({
          id: `${item.stationId}-${alert.id || alert.type || result.length}`, station_id: item.stationId,
          station_name: site?.river || item.stationId, category: String(alert.severity || alert.type || 'ALERT').toUpperCase(),
          status: alert.message || alert.description || 'Active alert from connected backend',
          observed: item.streamflow?.value, threshold: item.risk?.thresholdValue,
          threshold_source: source || 'Not supplied', date: alert.created_at || item.streamflow?.time || 'Unavailable',
        })
      }
      if (item.rapidRiseAlert || item.unusualObservation) result.push({
        id: `${item.stationId}-backend-flag`, station_id: item.stationId, station_name: site?.river || item.stationId,
        category: item.rapidRiseAlert ? 'RAPID RISE' : 'UNUSUAL OBSERVATION',
        status: 'Flag supplied by connected backend', observed: item.streamflow?.value,
        threshold: item.risk?.thresholdValue, threshold_source: source || 'Backend flag', date: item.streamflow?.time || 'Unavailable',
      })
    }
    return result
  }, [snapshot, stations])
  const columns = [
    { key: 'station_id', label: 'Station ID' }, { key: 'station_name', label: 'Station' },
    { key: 'category', label: 'Risk / alert' }, { key: 'status', label: 'Alert status' },
    { key: 'observed', label: 'Observed discharge (cfs)', render: value => value == null ? 'Unavailable' : formatValue(value) },
    { key: 'threshold', label: 'Threshold (cfs)', render: value => value == null ? 'Unavailable' : formatValue(value) },
    { key: 'threshold_source', label: 'Threshold source' }, { key: 'date', label: 'Observation / alert time' },
  ]
  if (loading) return <Loading/>
  if (error) return <ErrorState error={error}/>
  return <>
    <PageHeader eyebrow="FLOOD INTELLIGENCE" title="Flood alerts" subtitle="Current conditions are listed only when a connected source supplies an active alert, classification, or sourced threshold comparison." actions={<StatusChip tone={snapshot ? 'blue' : 'neutral'}>{snapshot ? 'CURRENT SOURCE DATA' : 'AWAITING SOURCE'}</StatusChip>}/>
    <div className="workspace-alert-banner">
      {rows.length ? <AlertTriangle size={18}/> : <ShieldCheck size={18}/>}
      <div><b>{rows.length ? `${rows.length} current alert or threshold record${rows.length === 1 ? '' : 's'}` : 'No verified active alerts returned'}</b><span>{liveError?.message || (snapshot ? `Source: ${snapshot.source}. Last retrieved ${new Date(snapshot.fetchedAt).toLocaleString()}.` : liveLoading ? 'Checking connected live feed…' : 'No live alert source is available.')}</span></div>
      <button type="button" className="workspace-export" onClick={refresh} disabled={refreshing}><BellRing size={14}/>{refreshing ? 'Refreshing…' : 'Refresh source'}</button>
    </div>
    <Panel title="Current alert records" subtitle="A record is included only when sourced from a backend alert, classification, or explicit threshold.">
      {rows.length ? <WorkspaceTable rows={rows} columns={columns} filename="floodcast-current-alerts.csv" rowKey="id"/> : <EmptyState icon={ShieldCheck} title="No sourced active alert records">{liveError?.message || 'The available public observation feed does not provide FLOODCAST alert classifications or persisted flood-warning history. No demonstration alerts or thresholds are fabricated.'}</EmptyState>}
    </Panel>
    <Panel title="Risk methodology" subtitle="Interpretation and source requirements">
      <div className="workspace-detail-list">
        <Detail label="Official warning levels" value="Not configured in this workspace"/>
        <Detail label="Risk thresholds" value="Displayed only with an explicit source and unit from the backend"/>
        <Detail label="Alert history" value="Unavailable without a persistent alert-history API"/>
        <Detail label="Model prediction thresholds" value="Not inferred from historical discharge"/>
      </div>
      <div className="workspace-notice"><ShieldCheck size={16}/><span>No demonstration thresholds are enabled. Any future demo threshold must be explicitly identified as non-official and configurable before use.</span></div>
    </Panel>
  </>
}
function Detail({ label, value }) { return <div className="workspace-detail-row"><span>{label}</span><b>{value}</b></div> }
