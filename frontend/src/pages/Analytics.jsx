import { useMemo, useState } from 'react'
import { Filter, TrendingUp } from 'lucide-react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Area, AreaChart, Bar, BarChart, ComposedChart, Line } from 'recharts'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, StatusChip } from '../components.jsx'
import { ChartDownload, formatValue } from '../components.jsx'
import { useData } from '../hooks/useData.js'
import { downloadCsv, getDataset } from '../services/workspaceData.js'

export default function Analytics() {
  const { data: train, error, loading } = useData(() => getDataset('train'), 'analytics-training')
  const { data: stationErrors } = useData(() => getDataset('per_station_raw'), 'analytics-station-errors')
  const [station, setStation] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const stations = useMemo(() => [...new Set((train || []).map(row => row.station_id))].sort(), [train])
  const stationErrorData = useMemo(() => (stationErrors || []).filter(row => station === 'all' || row.station_id === station).slice().sort((a, b) => Number(b.overall_rmse) - Number(a.overall_rmse)).slice(0, 12), [stationErrors, station])
  const filtered = useMemo(() => (train || []).filter(row => {
    const date = String(row.date || '').slice(0, 10)
    return (station === 'all' || row.station_id === station) && (!from || date >= from) && (!to || date <= to)
  }), [train, station, from, to])
  const monthly = useMemo(() => {
    const groups = new Map()
    for (const row of filtered) {
      const month = String(row.date || '').slice(5, 7)
      const flow = Number(row.discharge_cfs)
      if (!month || !Number.isFinite(flow)) continue
      const item = groups.get(month) || { month, total: 0, count: 0, rainTotal: 0, rainCount: 0 }
      item.total += flow
      item.count += 1
      const rain = valid(row.precipitation_mm)
      if (rain != null) { item.rainTotal += rain; item.rainCount += 1 }
      groups.set(month, item)
    }
    return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month)).map(item => ({ ...item, average: item.total / item.count, rainfall: item.rainCount ? item.rainTotal / item.rainCount : null, label: new Date(2000, Number(item.month) - 1, 1).toLocaleString('en', { month: 'short' }) }))
  }, [filtered])
  const sample = useMemo(() => {
    const stride = Math.max(1, Math.ceil(filtered.length / 900))
    return filtered.filter((row, index) => index % stride === 0).map(row => ({
      precipitation: valid(row.precipitation_mm), temperature: valid(row.temp_mean_c ?? row.temp_max_c),
      soil: valid(row.soil_moisture ?? row.soil_moisture_0_7cm), discharge: valid(row.discharge_cfs),
      area: valid(row.drainage_area_sqmi), station_id: row.station_id, date: row.date,
    })).filter(row => row.discharge != null)
  }, [filtered])
  const histogram = useMemo(() => {
    const flows = filtered.map(row => valid(row.discharge_cfs)).filter(value => value != null)
    if (!flows.length) return []
    const max = Math.max(...flows)
    const width = max > 0 ? max / 12 : 1
    const bins = Array.from({ length: 12 }, (_, index) => ({ range: `${formatValue(index * width, 0)}–${formatValue((index + 1) * width, 0)}`, count: 0 }))
    flows.forEach(value => { bins[Math.min(11, Math.floor(value / width))].count += 1 })
    return bins
  }, [filtered])
  const extremes = useMemo(() => {
    const perStation = new Map()
    filtered.forEach(row => {
      const flow = valid(row.discharge_cfs)
      if (flow == null) return
      if (!perStation.has(row.station_id)) perStation.set(row.station_id, [])
      perStation.get(row.station_id).push(flow)
    })
    const thresholds = new Map([...perStation].map(([id, flows]) => [id, quantile(flows, .9)]))
    const rows = filtered.filter(row => valid(row.discharge_cfs) >= thresholds.get(row.station_id))
    const groups = new Map()
    rows.forEach(row => {
      const month = String(row.date).slice(5, 7)
      const item = groups.get(month) || { month, total: 0, count: 0 }
      item.total += Number(row.discharge_cfs)
      item.count += 1
      groups.set(month, item)
    })
    return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month)).map(item => ({ ...item, average: item.total / item.count, label: new Date(2000, Number(item.month) - 1, 1).toLocaleString('en', { month: 'short' }) }))
  }, [filtered])

  if (loading) return <Loading/>
  if (error) return <ErrorState error={error}/>
  return <>
    <PageHeader eyebrow="HYDROLOGICAL ANALYTICS" title="Explore the data" subtitle="Charts use the expanded training table. Associations are descriptive only and do not imply causal effects." actions={<StatusChip tone="blue">OBSERVED TRAINING DATA</StatusChip>}/>
    <div className="workspace-filter-row analytics-filters">
      <label>Station<select value={station} onChange={event => setStation(event.target.value)}><option value="all">All stations</option>{stations.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>To<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
      <span><Filter size={14}/>{filtered.length.toLocaleString()} of {train.length.toLocaleString()} training rows</span>
      <button className="workspace-export" type="button" onClick={() => downloadCsv(filtered, 'floodcast-analytics-filtered.csv')} disabled={!filtered.length}>Download chart data</button>
    </div>
    <div className="workspace-two-col">
      <Panel title="Observed discharge distribution" subtitle="Counts by equal-width cfs bins">
        {histogram.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={histogram}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="range" minTickGap={30}/><YAxis/><Tooltip/><Bar dataKey="count" name="Rows" fill="#63d5cf" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer> : <EmptyState>No valid discharge values for this filter.</EmptyState>}
      </Panel>
      <Panel title="Seasonal discharge pattern" subtitle="Monthly average observed discharge (cfs)">
        {monthly.length ? <ResponsiveContainer width="100%" height={260}><AreaChart data={monthly}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label"/><YAxis width={65}/><Tooltip formatter={value => [`${formatValue(value)} cfs`, 'Mean observed']}/><Area dataKey="average" name="Monthly mean" stroke="#61d6d1" fill="#61d6d1" fillOpacity={.13}/></AreaChart></ResponsiveContainer> : <EmptyState>Seasonal data is unavailable.</EmptyState>}
      </Panel>
      <Panel title="Monthly rainfall and discharge" subtitle="Monthly mean precipitation (mm) beside mean observed flow (cfs)">
        {monthly.some(row => row.rainfall != null) ? <ResponsiveContainer width="100%" height={260}><ComposedChart data={monthly}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label"/><YAxis yAxisId="rain" width={52}/><YAxis yAxisId="flow" orientation="right" width={58}/><Tooltip/><Bar yAxisId="rain" dataKey="rainfall" name="Mean precipitation (mm)" fill="#8bb9ff" fillOpacity={.72}/><Line yAxisId="flow" dataKey="average" name="Mean discharge (cfs)" stroke="#64d8d1" strokeWidth={2}/></ComposedChart></ResponsiveContainer> : <EmptyState>Rainfall values are unavailable in these training rows.</EmptyState>}
      </Panel>
      <Panel title="Precipitation vs discharge" subtitle="Training-row values · descriptive scatter" action={<ChartDownload targetId="precip-discharge" filename="precipitation-discharge"/>}>
        {sample.some(row => row.precipitation != null) ? <div id="precip-discharge"><ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid stroke="#33515a" strokeDasharray="3 5"/><XAxis type="number" dataKey="precipitation" name="Precipitation" unit=" mm"/><YAxis type="number" dataKey="discharge" name="Observed discharge" unit=" cfs" width={65}/><Tooltip cursor={{ strokeDasharray: '3 3' }}/><Scatter data={sample.filter(row => row.precipitation != null)} fill="#63d5cf" fillOpacity={.55}/></ScatterChart></ResponsiveContainer></div> : <EmptyState>Precipitation is unavailable in the selected rows.</EmptyState>}
      </Panel>
      <Panel title="Temperature vs discharge" subtitle="Weather features from the training table">
        {sample.some(row => row.temperature != null) ? <ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid stroke="#33515a" strokeDasharray="3 5"/><XAxis type="number" dataKey="temperature" name="Temperature" unit=" °C"/><YAxis type="number" dataKey="discharge" name="Observed discharge" unit=" cfs" width={65}/><Tooltip cursor={{ strokeDasharray: '3 3' }}/><Scatter data={sample.filter(row => row.temperature != null)} fill="#8bb9ff" fillOpacity={.55}/></ScatterChart></ResponsiveContainer> : <EmptyState>Temperature values are unavailable.</EmptyState>}
      </Panel>
      <Panel title="Soil moisture vs discharge" subtitle="Training-row values · descriptive scatter">
        {sample.some(row => row.soil != null) ? <ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid stroke="#33515a" strokeDasharray="3 5"/><XAxis type="number" dataKey="soil" name="Soil moisture"/><YAxis type="number" dataKey="discharge" name="Observed discharge" unit=" cfs" width={65}/><Tooltip cursor={{ strokeDasharray: '3 3' }}/><Scatter data={sample.filter(row => row.soil != null)} fill="#edb76b" fillOpacity={.6}/></ScatterChart></ResponsiveContainer> : <EmptyState>Soil moisture values are unavailable.</EmptyState>}
      </Panel>
      <Panel title="Station area vs discharge" subtitle="Reported drainage area (sq mi) vs observed flow">
        {sample.some(row => row.area != null) ? <ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid stroke="#33515a" strokeDasharray="3 5"/><XAxis type="number" dataKey="area" name="Drainage area" unit=" sq mi"/><YAxis type="number" dataKey="discharge" name="Observed discharge" unit=" cfs" width={65}/><Tooltip cursor={{ strokeDasharray: '3 3' }}/><Scatter data={sample.filter(row => row.area != null)} fill="#c7a6ff" fillOpacity={.55}/></ScatterChart></ResponsiveContainer> : <EmptyState>Drainage-area values are unavailable.</EmptyState>}
      </Panel>
      <Panel title="Top-decile observed flow by month" subtitle="Per-station q90 observations; historical labels only">
        {extremes.length ? <ResponsiveContainer width="100%" height={255}><ComposedChart data={extremes}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label"/><YAxis width={65}/><Tooltip formatter={value => [`${formatValue(value)} cfs`, 'Top-decile mean']}/><Bar dataKey="count" name="Top-decile records" fill="#edb76b" fillOpacity={.5}/><Line dataKey="average" name="Mean flow" stroke="#64d8d1" strokeWidth={2}/></ComposedChart></ResponsiveContainer> : <EmptyState>No extreme-flow values are available.</EmptyState>}
      </Panel>
      <Panel title="Station-wise validation error" subtitle="Held-out station RMSE from saved validation report">
        {stationErrorData.length ? <ResponsiveContainer width="100%" height={255}><BarChart data={stationErrorData} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="station_id" width={78}/><Tooltip formatter={value => [`${formatValue(value, 2)} cfs`, 'RMSE']}/><Bar dataKey="overall_rmse" name="RMSE" fill="#edb76b" radius={[0, 4, 4, 0]}/></BarChart></ResponsiveContainer> : <EmptyState>Per-station validation reports are unavailable for this station filter.</EmptyState>}
      </Panel>
    </div>
    <div className="workspace-notice"><TrendingUp size={16}/><span>Extreme events use the top 10% of observed discharge values within each station over the selected data window; this is an analysis filter, not an official flood threshold.</span></div>
  </>
}

function valid(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower])
}
