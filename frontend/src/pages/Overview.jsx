import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowUpRight, CloudRain, Database, MapPin, Waves } from 'lucide-react'
import { getOverview } from '../services/data.js'
import { useData } from '../hooks/useData.js'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'
import { EmptyState, ErrorState, KPI, Loading, Panel, Select, StationMap, StatusChip, formatValue } from '../components.jsx'
import LandscapeSection from '../components/LandscapeSection.jsx'

export default function Overview() {
  const {data,error,loading}=useData(getOverview,'overview')
  const {stationId,setStationId,dateRange}=useWorkspaceState()
  const station=data?.stations.find(s=>s.id===stationId)
  const chart=useMemo(()=>{const count=dateRange==='all'?station?.discharge.length:Number(dateRange);return station?.discharge.slice(-count).map(d=>({...d,label:new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}))||[]},[station,dateRange])
  if(loading)return <Loading/>; if(error)return <ErrorState error={error}/>
  const stations=data.stations
  const latest=station?.latest
  return <>
    <section className="overview-hero">
      <div className="overview-hero-copy"><span className="hero-kicker"><i/> USGS RIVER OBSERVATION NETWORK</span><h1>Water intelligence<br/><em>in a wider view.</em></h1><p>Follow observed river flow alongside the landscapes, catchments, and weather that shape it.</p><div className="hero-actions"><Link className="hero-primary" to="/monitoring">Explore stations <ArrowUpRight size={16}/></Link><Link className="hero-secondary" to="/catchment">Explore catchments</Link></div><div className="hero-stat-row"><div><b>{stations.length}</b><span>USGS stations</span></div><div><b>{formatValue(data.totalRecords)}</b><span>daily flow records</span></div><div><b>{stations.reduce((latest,s)=>!latest||s.latest?.date>latest?s.latest?.date:latest,'')||'—'}</b><span>latest record date</span></div></div></div>
      <div className="overview-hero-image"><img src="/images/reservoir-morning.jpg" alt="Aerial view of a forested reservoir at morning"/><div className="hero-image-shade"/><span className="hero-image-label"><i/> WATERSHED LANDSCAPE <small>Illustrative image</small></span><div className="hero-image-caption"><span>Water systems,</span><b>seen from above.</b></div></div>
    </section>
    <div className="kpi-grid">
      <KPI label="Monitoring stations" value={stations.length} icon={MapPin} note="USGS daily streamflow sites"/>
      <KPI label="Historical records" value={formatValue(data.totalRecords)} icon={Database} tone="blue" note="Daily mean discharge · all sites"/>
      <KPI label="Latest historical daily mean" value={latest?formatValue(latest.discharge):'—'} suffix={latest?'cfs':undefined} icon={Waves} tone="blue" note={latest?`${station.river} · record date ${latest.date}`:'No historical measurement'} />
      <KPI label="High-risk stations" value="—" icon={Activity} tone="amber" note="Risk classification unavailable"/>
    </div>
    <div className="overview-grid">
      <Panel title="Station network" subtitle="Explore gauges, switch map layers, or reveal a verified basin boundary" action={<Link className="text-action" to="/monitoring">Explore network <ArrowUpRight size={14}/></Link>} className="map-panel"><StationMap stations={stations} selected={stationId} onSelect={setStationId}/></Panel>
      <Panel title="Station conditions" subtitle="Latest historical daily mean in the project records" action={<Select value={stationId} onChange={setStationId} options={stations.map(s=>({value:s.id,label:s.id}))} label="Choose station"/>}>
        <div className="station-hero"><div className="river-icon"><Waves size={20}/></div><div><b>{station?.river}</b><span>{station?.name} · {station?.state}</span></div><StatusChip tone="blue">USGS</StatusChip></div>
        <div className="flow-reading"><div className="flow-value">{latest?formatValue(latest.discharge):'—'}<small>{latest?'cfs':''}</small></div><div className="flow-caption"><i/> DAILY MEAN DISCHARGE</div></div>
        <div className="mini-stats"><div><span>Drainage area</span><b>{formatValue(station?.drainageArea)} <small>sq mi</small></b></div><div><span>Last record</span><b>{latest?.date||'—'}</b></div></div>
        <div className="callout"><CloudRain size={15}/><span>Prediction feed is not connected. Measurements shown are observed USGS daily means.</span></div>
      </Panel>
      <Panel title="Discharge history" subtitle={`${station?.river} · observed daily mean (cfs) · ${dateRange==='all'?'all records':`last ${dateRange} days`}`} action={<Select value={stationId} onChange={setStationId} options={stations.map(s=>({value:s.id,label:s.id}))} label="Choose station"/>} className="chart-panel">
        {chart.length?<ResponsiveContainer width="100%" height={250}><AreaChart data={chart} margin={{top:12,right:8,left:0,bottom:0}}><defs><linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#267fc0" stopOpacity={.26}/><stop offset="100%" stopColor="#267fc0" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#e3ebf1" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fill:'#74899b',fontSize:13}} tickLine={false} axisLine={false} minTickGap={35}/><YAxis tick={{fill:'#74899b',fontSize:13}} tickLine={false} axisLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} width={40}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #d7e3eb',borderRadius:10,color:'#1e3c54'}} formatter={v=>[`${Number(v).toLocaleString()} cfs`,'Observed']} labelStyle={{color:'#627b90'}}/><Area type="monotone" dataKey="discharge" stroke="#267fc0" strokeWidth={2} fill="url(#flowFill)" dot={false} activeDot={{r:4,fill:'#8ed6e8'}}/></AreaChart></ResponsiveContainer>:<EmptyState>No historical discharge data available for this station.</EmptyState>}
        <div className="chart-foot"><span><i className="legend-dot blue"/> Observed daily mean</span><span>Most recent 365 available records</span></div>
      </Panel>
      <Panel title="Watershed snapshot" subtitle="Selected station · catchment characteristics" action={<Link className="text-action" to="/catchment">Explore catchment <ArrowUpRight size={14}/></Link>}>
        <div className="snapshot-list"><Snapshot label="Mean basin elevation" value={station?.elevation} unit="m"/><Snapshot label="Forest cover" value={station?.forest} unit="%"/><Snapshot label="Impervious surface" value={station?.impervious} unit="%"/><Snapshot label="Annual precipitation" value={station?.precipitation} unit="mm"/></div>
        <div className="source-note">NLCD 2024 · PRISM 1991–2020 · USGS 3DEP, where available</div>
      </Panel>
      <Panel title="Network overview" subtitle="Coverage across four monitored rivers">
        <div className="network-list">{stations.map((s,i)=><button key={s.id} onClick={()=>setStationId(s.id)} className={`network-row ${s.id===stationId?'chosen':''}`}><span className={`network-marker marker-${i%2}`}/><span className="network-name"><b>{s.river}</b><small>{s.id} · {s.state}</small></span><span className="network-flow">{s.latest?`${formatValue(s.latest.discharge)} cfs`:'—'}</span><ArrowUpRight size={14}/></button>)}</div>
      </Panel>
    </div>
    <LandscapeSection />
  </>
}
function Snapshot({label,value,unit}) { return <div className="snapshot-row"><span>{label}</span><b>{value==null?<em>Unavailable</em>:`${formatValue(value,1)} ${unit}`}</b></div> }
