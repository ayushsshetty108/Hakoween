import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowUpRight, CloudRain, Database, MapPin, Waves } from 'lucide-react'
import { getOverview } from '../services/data.js'
import { getDataset } from '../services/workspaceData.js'
import { useData } from '../hooks/useData.js'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'
import { useLiveStations } from '../hooks/LiveStationsContext.jsx'
import { EmptyState, ErrorState, KPI, Loading, Panel, Select, StationMap, StatusChip, formatValue } from '../components.jsx'
import LandscapeSection from '../components/LandscapeSection.jsx'

export default function Overview() {
  const {data,error,loading}=useData(getOverview,'overview')
  const {data:predictionRows}=useData(()=>getDataset('predictions'),'dashboard-predictions')
  const {data:oofRows}=useData(()=>getDataset('oof_raw'),'dashboard-oof')
  const {snapshot}=useLiveStations()
  const {stationId,setStationId,dateRange}=useWorkspaceState()
  const station=data?.stations.find(s=>s.id===stationId)
  const chart=useMemo(()=>{const count=dateRange==='all'?station?.discharge.length:Number(dateRange);return station?.discharge.slice(-count).map(d=>({...d,label:new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}))||[]},[station,dateRange])
  if(loading)return <Loading/>; if(error)return <ErrorState error={error}/>
  const stations=data.stations
  const latest=station?.latest
  const predictionValues=(predictionRows||[]).map(row=>Number(row.discharge_cfs)).filter(Number.isFinite)
  const averagePrediction=predictionValues.length?predictionValues.reduce((sum,value)=>sum+value,0)/predictionValues.length:null
  const validation=dashboardMetrics(oofRows||[])
  const activeAlerts=snapshot?.backendConnected?(snapshot.stations||[]).reduce((count,item)=>{
    const threshold=Number(item.risk?.thresholdValue)
    const observed=Number(item.streamflow?.value)
    const exceeded=item.risk?.thresholdSource&&item.streamflow?.value!=null&&Number.isFinite(threshold)&&Number.isFinite(observed)&&observed>=threshold
    return count+(item.alerts||[]).filter(alert=>alert.active===true).length+(item.rapidRiseAlert?1:0)+(item.unusualObservation?1:0)+(exceeded?1:0)
  },0):null
  const predictionHistory=(predictionRows||[]).map(row=>({station_id:String(row.station_id||''),date:String(row.date||'').slice(0,10),discharge:Number(row.discharge_cfs)})).filter(row=>row.station_id&&row.date&&Number.isFinite(row.discharge)).sort((a,b)=>a.date.localeCompare(b.date))
  const latestPredictions=predictionHistory.slice(-5).reverse()
  const activeAlertItems=snapshot?.backendConnected?(snapshot.stations||[]).flatMap(item=>(item.alerts||[]).filter(alert=>alert.active===true).map(alert=>({station:item.stationId,title:alert.message||alert.type||'Active backend alert',time:alert.created_at||item.streamflow?.time||'Time unavailable'}))):[]
  return <>
    <section className="overview-hero">
      <div className="overview-hero-copy"><span className="hero-kicker"><i/> USGS RIVER OBSERVATION NETWORK</span><h1>Water intelligence<br/><em>in a wider view.</em></h1><p>Follow observed river flow alongside the landscapes, catchments, and weather that shape it.</p><div className="hero-actions"><Link className="hero-primary" to="/monitoring">Explore stations <ArrowUpRight size={16}/></Link><Link className="hero-secondary" to="/catchment">Explore catchments</Link></div><div className="hero-stat-row"><div><b>{stations.length}</b><span>USGS stations</span></div><div><b>{formatValue(data.totalRecords)}</b><span>daily flow records</span></div><div><b>{stations.reduce((latest,s)=>!latest||s.latest?.date>latest?s.latest?.date:latest,'')||'—'}</b><span>latest record date</span></div></div></div>
      <div className="overview-hero-image"><img src="/images/reservoir-morning.jpg" alt="Aerial view of a forested reservoir at morning"/><div className="hero-image-shade"/><span className="hero-image-label"><i/> WATERSHED LANDSCAPE <small>Illustrative image</small></span><div className="hero-image-caption"><span>Water systems,</span><b>seen from above.</b></div></div>
    </section>
    <div className="kpi-grid dashboard-kpis">
      <KPI label="Monitoring stations" value={stations.length} icon={MapPin} note="USGS daily streamflow sites"/>
      <KPI label="Prediction records" value={predictionRows?formatValue(predictionRows.length):'—'} icon={Database} tone="blue" note={predictionRows?'Generated prediction.csv':'Prediction output unavailable'}/>
      <KPI label="Active flood alerts" value={activeAlerts==null?'—':activeAlerts} icon={Activity} tone="amber" note={activeAlerts==null?'Verified backend alert feed unavailable':'Current backend-supplied alerts only'}/>
      <KPI label="Average predicted discharge" value={averagePrediction==null?'—':formatValue(averagePrediction)} suffix={averagePrediction==null?undefined:'cfs'} icon={Waves} tone="blue" note="Mean of generated prediction rows"/>
      <KPI label="Overall RMSE" value={validation?formatValue(validation.rmse):'—'} suffix={validation?'cfs':undefined} icon={Activity} note={validation?'Station-held-out OOF records':'Validation report unavailable'}/>
      <KPI label="Extreme-event RMSE" value={validation?formatValue(validation.extremeRmse):'—'} suffix={validation?'cfs':undefined} icon={Waves} tone="amber" note={validation?'Station-specific top-decile flow':'Validation report unavailable'}/>
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
      <Panel title="Recent model predictions" subtitle="Generated output · not observed discharge" action={<Link className="text-action" to="/predictions">View output <ArrowUpRight size={14}/></Link>}>
        {predictionHistory.length?<><ResponsiveContainer width="100%" height={185}><LineChart data={predictionHistory.slice(-90)}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" minTickGap={45}/><YAxis width={55}/><Tooltip formatter={value=>[`${formatValue(value)} cfs`,'Predicted']}/><Line dataKey="discharge" name="Predicted" type="monotone" stroke="#62d8d1" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer><div className="prediction-activity-list">{latestPredictions.map((row,index)=><div key={`${row.station_id}-${row.date}-${index}`}><b>{row.station_id}</b><span>{row.date}</span><strong>{formatValue(row.discharge)} cfs</strong></div>)}</div></>:<EmptyState>No generated prediction file is available.</EmptyState>}
      </Panel>
      <Panel title="Recent verified alerts" subtitle="Backend-supplied active items only">
        {activeAlerts==null?<EmptyState icon={Activity} title="Alert feed unavailable">No connected backend alert feed is available. The public observation fallback does not provide verified flood alerts.</EmptyState>:activeAlertItems.length?<div className="prediction-activity-list">{activeAlertItems.map((item,index)=><div key={`${item.station}-${index}`}><b>{item.station}</b><span>{item.title}</span><strong>{item.time}</strong></div>)}</div>:<EmptyState icon={Activity} title="No active alerts returned">No active alert records were supplied by the connected backend.</EmptyState>}
        <div className="source-note">Flood-risk distribution is unavailable until the backend returns sourced risk classifications; no category is inferred.</div>
      </Panel>
    </div>
    <LandscapeSection />
  </>
}
function Snapshot({label,value,unit}) { return <div className="snapshot-row"><span>{label}</span><b>{value==null?<em>Unavailable</em>:`${formatValue(value,1)} ${unit}`}</b></div> }

function dashboardMetrics(rows) {
  const values=rows.map(row=>({station:row.station_id,actual:Number(row.discharge_cfs),predicted:Number(row.pred_cfs)})).filter(row=>Number.isFinite(row.actual)&&Number.isFinite(row.predicted))
  if(!values.length)return null
  const squared=values.reduce((sum,row)=>sum+(row.predicted-row.actual)**2,0)
  const groups=new Map()
  values.forEach(row=>{if(!groups.has(row.station))groups.set(row.station,[]);groups.get(row.station).push(row.actual)})
  const q90=new Map([...groups].map(([id,flows])=>[id,quantile(flows,.9)]))
  const peaks=values.filter(row=>row.actual>=q90.get(row.station))
  return {rmse:Math.sqrt(squared/values.length),extremeRmse:Math.sqrt(peaks.reduce((sum,row)=>sum+(row.predicted-row.actual)**2,0)/peaks.length)}
}
function quantile(values,q) { const sorted=values.slice().sort((a,b)=>a-b);const position=(sorted.length-1)*q;const lower=Math.floor(position);const fraction=position-lower;return sorted[lower]+fraction*((sorted[Math.min(lower+1,sorted.length-1)]??sorted[lower])-sorted[lower]) }
