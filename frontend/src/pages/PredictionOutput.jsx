import { useMemo, useState } from 'react'
import { Activity, CalendarDays, Waves } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, StatusChip, formatValue } from '../components.jsx'
import WorkspaceTable from '../components/WorkspaceTable.jsx'
import { useData } from '../hooks/useData.js'
import { getDataset } from '../services/workspaceData.js'

export default function PredictionOutput() {
  const { data, error, loading } = useData(() => getDataset('predictions'), 'prediction-output')
  const [station, setStation] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const stations = useMemo(() => [...new Set((data || []).map(row => String(row.station_id || '')))].filter(Boolean).sort(), [data])
  const filtered = useMemo(() => (data || []).filter(row => {
    const date = String(row.date || '').slice(0, 10)
    return (station === 'all' || row.station_id === station) && (!from || date >= from) && (!to || date <= to)
  }).map((row, index) => ({ ...row, rowKey: `${row.station_id}-${row.date}-${index}`, discharge: Number(row.discharge_cfs) }))
    .filter(row => Number.isFinite(row.discharge)), [data, station, from, to])
  const chart = useMemo(() => filtered.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map(row => ({ ...row, date: String(row.date).slice(0, 10) })), [filtered])
  const columns = [
    { key: 'station_id', label: 'Station ID' },
    { key: 'date', label: 'Prediction date' },
    { key: 'discharge_cfs', label: 'Predicted discharge (cfs)', render: value => formatValue(value) },
    { key: 'risk', label: 'Risk classification', render: () => 'Unavailable — no verified threshold' },
  ]
  if (loading) return <Loading/>
  if (error) return <><PageHeader eyebrow="MODEL OUTPUT" title="Predictions" subtitle="Read generated output without treating it as an observation."/><EmptyState icon={Activity} title="Prediction output is unavailable">{error.message} Run <code>python solution.py</code> from the project root to generate prediction.csv.</EmptyState></>
  const mean = filtered.length ? filtered.reduce((sum, row) => sum + row.discharge, 0) / filtered.length : null
  const latest = filtered.reduce((best, row) => !best || String(row.date) > String(best.date) ? row : best, null)
  return <>
    <PageHeader eyebrow="MODEL OUTPUT" title="Discharge predictions" subtitle="Generated prediction.csv records. These values are model outputs—not USGS observations or verified flood warnings." actions={<StatusChip tone="blue">PREDICTION FILE</StatusChip>}/>
    <div className="workspace-kpis">
      <Summary label="Prediction records" value={filtered.length.toLocaleString()} note={`${stations.length} station${stations.length === 1 ? '' : 's'} in the selected output`}/>
      <Summary label="Average predicted flow" value={mean == null ? '—' : formatValue(mean)} unit={mean == null ? '' : 'cfs'} note="Filtered prediction rows only"/>
      <Summary label="Latest prediction date" value={latest?.date || '—'} note={latest ? `Station ${latest.station_id}` : 'No matching output rows'}/>
    </div>
    <div className="workspace-filter-row prediction-filters">
      <label>Station<select value={station} onChange={event => setStation(event.target.value)}><option value="all">All stations</option>{stations.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <label><CalendarDays size={14}/> From<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label><CalendarDays size={14}/> To<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
      {(station !== 'all' || from || to) && <button className="text-action" type="button" onClick={() => { setStation('all'); setFrom(''); setTo('') }}>Clear filters</button>}
    </div>
    <Panel title="Prediction time series" subtitle="Selected rows · cfs">
      {chart.length ? <ResponsiveContainer width="100%" height={270}><LineChart data={chart}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" minTickGap={40}/><YAxis width={65}/><Tooltip formatter={value => [`${formatValue(value)} cfs`, 'Predicted']} /><Line type="monotone" dataKey="discharge" name="Predicted" stroke="#64d8d1" strokeWidth={2} dot={false} activeDot={{ r: 4 }}/></LineChart></ResponsiveContainer> : <EmptyState icon={Waves}>No prediction rows match these filters.</EmptyState>}
    </Panel>
    <Panel title="Prediction records" subtitle="Risk classifications remain unavailable unless a verified threshold source is connected.">
      <WorkspaceTable rows={filtered} columns={columns} filename="floodcast-predictions.csv" rowKey="rowKey" pageSize={15}/>
    </Panel>
  </>
}

function Summary({ label, value, unit, note }) {
  return <div className="workspace-metric"><span>{label}</span><b>{value}{unit && <small> {unit}</small>}</b><small>{note}</small></div>
}
