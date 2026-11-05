import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, MapPin, Waves } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, Select, StatusChip, formatValue } from '../components.jsx'
import WorkspaceTable from '../components/WorkspaceTable.jsx'
import { useData } from '../hooks/useData.js'
import { getStations, getWeather } from '../services/data.js'
import { getDataset } from '../services/workspaceData.js'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'

export default function Stations() {
  const { stationId: routeStation } = useParams()
  const { data, error, loading } = useData(getStations, 'station-directory')
  const { data: weatherRows } = useData(() => routeStation ? getWeather(routeStation) : Promise.resolve([]), `station-weather-${routeStation || 'none'}`)
  const { data: stationOutputs } = useData(() => routeStation ? Promise.all([getDataset('predictions'), getDataset('per_station_raw')]) : Promise.resolve([[], []]), `station-output-${routeStation || 'none'}`)
  const { stationId, setStationId } = useWorkspaceState()
  const [region, setRegion] = useState('all')
  const selectedId = routeStation || stationId
  const station = data?.find(item => item.id === selectedId)
  const regions = useMemo(() => [...new Set((data || []).map(item => item.state).filter(Boolean))].sort(), [data])

  if (loading) return <Loading/>
  if (error) return <ErrorState error={error}/>

  if (routeStation) {
    if (!station) return <><PageHeader eyebrow="STATION DIRECTORY" title="Station not found" subtitle="This station is not included in the available project metadata."/><Link className="text-action" to="/stations"><ArrowLeft size={14}/> Back to stations</Link></>
    const graph = (station.discharge || []).slice(-365).map(row => ({ ...row, label: row.date }))
    const stationWeather = (weatherRows || []).slice(-90)
    const predictions = (stationOutputs?.[0] || []).filter(row => row.station_id === station.id)
    const validation = (stationOutputs?.[1] || []).find(row => row.station_id === station.id)
    return <>
      <PageHeader eyebrow="STATION PROFILE" title={station.river} subtitle={`${station.name} · ${station.state} · USGS ${station.id}`} actions={<Link className="text-action" to="/stations"><ArrowLeft size={14}/> All stations</Link>}/>
      <div className="workspace-kpis">
        <Metric label="Station ID" value={station.id} note="USGS site metadata"/>
        <Metric label="Drainage area" value={formatValue(station.drainageArea)} unit="sq mi" note="Reported station attribute"/>
        <Metric label="Historical daily records" value={formatValue(station.records)} note="Project USGS daily discharge file"/>
        <Metric label="Most recent historical flow" value={formatValue(station.latest?.discharge)} unit={station.latest ? 'cfs' : ''} note={station.latest ? `Observation date ${station.latest.date}` : 'No observation available'}/>
      </div>
      <div className="workspace-two-col">
        <Panel title="Historical discharge" subtitle="Observed USGS daily means · not a forecast">
          {graph.length ? <ResponsiveContainer width="100%" height={280}><AreaChart data={graph}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" minTickGap={45}/><YAxis width={58}/><Tooltip formatter={value => [`${formatValue(value)} cfs`, 'Observed']} /><Area dataKey="discharge" name="Observed" type="monotone" stroke="#61d6d1" fill="#61d6d1" fillOpacity={0.14} dot={false}/></AreaChart></ResponsiveContainer> : <EmptyState icon={Waves}>Historical discharge is unavailable for this station.</EmptyState>}
        </Panel>
        <Panel title="Site details" subtitle="Metadata and coverage available in this workspace">
          <div className="workspace-detail-list">
            <Detail label="Coordinates" value={Number.isFinite(station.latitude) && Number.isFinite(station.longitude) ? `${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)}` : 'Unavailable'}/>
            <Detail label="Station location" value={`${station.name}, ${station.state}`}/>
            <Detail label="Drainage area" value={station.drainageArea == null ? 'Unavailable' : `${formatValue(station.drainageArea)} sq mi`}/>
            <Detail label="Basin elevation" value={station.elevation == null ? 'Unavailable' : `${formatValue(station.elevation, 1)} m`}/>
            <Detail label="Slope" value={station.slope == null ? 'Unavailable' : `${formatValue(station.slope, 2)}%`}/>
            <Detail label="Forest cover" value={station.forest == null ? 'Unavailable' : `${formatValue(station.forest, 1)}%`}/>
          </div>
          <div className="workspace-notice"><MapPin size={16}/> <span>Live readings, official flood thresholds, and model forecasts are shown only when returned by a connected source.</span></div>
          <StatusChip tone="blue">Historical source · USGS daily discharge</StatusChip>
        </Panel>
        <Panel title="Historical weather context" subtitle="Open-Meteo gridded history · not a live forecast">
          {stationWeather.length ? <ResponsiveContainer width="100%" height={245}><AreaChart data={stationWeather}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" minTickGap={40}/><YAxis yAxisId="rain"/><YAxis yAxisId="temp" orientation="right"/><Tooltip/><Area yAxisId="rain" dataKey="precipitation" name="Precipitation (mm)" stroke="#68c7d2" fill="#68c7d2" fillOpacity={.12}/><Area yAxisId="temp" dataKey="maxTemp" name="Maximum temperature (°C)" stroke="#edb76b" fill="none"/></AreaChart></ResponsiveContainer> : <EmptyState>Historical weather rows are unavailable for this station.</EmptyState>}
        </Panel>
        <Panel title="Predictions and validation" subtitle="Only station-matched model outputs and held-out validation are shown">
          {predictions.length ? <div className="prediction-activity-list">{predictions.slice(-5).reverse().map((row, index) => <div key={`${row.date}-${index}`}><b>{row.station_id}</b><span>{row.date}</span><strong>{formatValue(row.discharge_cfs)} cfs</strong></div>)}</div> : <div className="workspace-notice"><Waves size={16}/><span>No generated prediction rows match this station in prediction.csv.</span></div>}
          <div className="workspace-detail-list">
            <Detail label="Held-out validation RMSE" value={validation?.overall_rmse == null ? 'Unavailable' : `${formatValue(validation.overall_rmse, 2)} cfs`}/>
            <Detail label="Held-out MAE" value={validation?.mae == null ? 'Unavailable' : `${formatValue(validation.mae, 2)} cfs`}/>
            <Detail label="Held-out R²" value={validation?.r2 == null ? 'Unavailable' : formatValue(validation.r2, 3)}/>
          </div>
          <div className="source-note">Prediction errors require matched held-out observations; no score is inferred from training fit.</div>
        </Panel>
      </div>
    </>
  }

  const rows = data.filter(item => region === 'all' || item.state === region).map(item => ({
    id: item.id, name: item.name, river: item.river, state: item.state,
    drainage: item.drainageArea, observed: item.latest?.discharge, observedDate: item.latest?.date,
    latitude: item.latitude, longitude: item.longitude, count: item.records,
  }))
  const columns = [
    { key: 'id', label: 'Station ID', render: value => <Link className="table-link" to={`/stations/${value}`}>{value} <ArrowUpRight size={13}/></Link> },
    { key: 'name', label: 'Station name' }, { key: 'river', label: 'River' }, { key: 'state', label: 'State' },
    { key: 'drainage', label: 'Drainage area (sq mi)', render: value => value == null ? 'Unavailable' : formatValue(value) },
    { key: 'observed', label: 'Latest observed (cfs)', render: value => value == null ? 'Unavailable' : formatValue(value) },
    { key: 'observedDate', label: 'Observation date' },
    { key: 'count', label: 'Records', render: value => formatValue(value) },
  ]
  return <>
    <PageHeader eyebrow="PROJECT NETWORK" title="Station directory" subtitle="Explore the verified USGS stations and their available historical records. No missing coordinates or readings are inferred." actions={<StatusChip tone="blue">{data.length} PROJECT STATIONS</StatusChip>}/>
    <div className="workspace-filter-row"><label>State<select value={region} onChange={event => setRegion(event.target.value)}><option value="all">All states</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}</select></label><span>Station risk status: unavailable until verified thresholds or a backend classification are connected.</span></div>
    <Panel title="Monitoring stations" subtitle="Latest available historical observation from the project data">
      <WorkspaceTable rows={rows} columns={columns} filename="floodcast-stations.csv" rowKey="id"/>
    </Panel>
    <div className="workspace-notice"><MapPin size={16}/><span>Use the <Link to="/live-map">live map</Link> to view stations with valid coordinates. Only the four project USGS gauges with source metadata are included in this directory.</span></div>
    {data.some(item => item.id === stationId) && <Select value={stationId} onChange={setStationId} options={data.map(item => ({ value: item.id, label: `${item.id} · ${item.river}` }))} label="Select workspace station"/>}
  </>
}

function Metric({ label, value, unit, note }) {
  return <div className="workspace-metric"><span>{label}</span><b>{value}{unit && <small> {unit}</small>}</b><small>{note}</small></div>
}
function Detail({ label, value }) {
  return <div className="workspace-detail-row"><span>{label}</span><b>{value}</b></div>
}
