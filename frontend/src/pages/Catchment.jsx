import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Droplets, Layers3, Mountain, Trees, Waves } from 'lucide-react'
import { getStations } from '../services/data.js'
import { useData } from '../hooks/useData.js'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, Select, StatusChip, formatValue } from '../components.jsx'

const metrics=[
 {key:'drainageArea',label:'Drainage area',unit:'sq mi',source:'USGS NWIS reported drainage area',icon:Waves,preferred:true},
 {key:'elevation',label:'Mean basin elevation',unit:'m',source:'USGS 3DEP · basin weighted',icon:Mountain},
 {key:'slope',label:'Mean basin slope',unit:'%',source:'USGS 3DEP slope raster · screened',icon:Mountain},
 {key:'forest',label:'Forest cover',unit:'%',source:'Annual NLCD 2024 · classes 41/42/43',icon:Trees},
 {key:'impervious',label:'Impervious surface',unit:'%',source:'Annual NLCD 2024 · fractional imperviousness',icon:Layers3},
 {key:'precipitation',label:'Mean annual precipitation',unit:'mm/year',source:'PRISM 1991–2020 · 4 km grid, area weighted',icon:Droplets},
 {key:'wetlands',label:'Wetland percentage',unit:'%',source:'NWI polygon coverage',icon:Waves},
]
export default function Catchment(){const {data,error,loading}=useData(getStations,'catchment');const {stationId,setStationId}=useWorkspaceState();const [metric,setMetric]=useState('forest');
 if(loading)return <Loading/>;if(error)return <ErrorState error={error}/>
 const selected=data.find(s=>s.id===stationId);const current=metrics.find(m=>m.key===metric)
 const comparison=data.map(s=>({station:s.id.slice(-4),name:s.river,value:s[metric]})).filter(s=>s.value!=null)
 const ordered=[...metrics.slice(0,6),metrics[6]]
 return <><PageHeader eyebrow="WATERSHED PROFILE" title="Catchment analytics" subtitle="Compare basin-scale attributes with source, period, and availability shown for every metric." actions={<StatusChip tone="blue">4 BASINS</StatusChip>}/>
 <div className="filter-bar"><div className="filter-label"><span className="filter-icon"><Layers3 size={16}/></span><div><b>Catchment selection</b><small>Station-linked watershed characteristics</small></div></div><div className="filters"><Select value={stationId} onChange={setStationId} options={data.map(s=>({value:s.id,label:`${s.id} · ${s.river}`}))} label="Choose station"/></div></div>
 <div className="catchment-grid"><Panel title="Basin profile" subtitle={`${selected.river} · ${selected.id}`} className="profile-panel"><div className="profile-area"><div><span>Reported drainage area</span><b>{formatValue(selected.drainageArea)} <small>sq mi</small></b></div><div><span>Contributing area</span><b>{selected.contributingArea==null?<em>Unavailable</em>:`${formatValue(selected.contributingArea)} sq mi`}</b></div></div><div className="profile-coordinates"><span>GAUGE LOCATION</span><b>{selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}</b><small>Coordinates from USGS station metadata</small></div><p className="metric-source">Reported NWIS drainage area is retained as documented. Exact basin polygon area differs for the Mississippi and Colorado River stations; see project boundary validation report.</p></Panel>
 <Panel title="Station comparison" subtitle={`${current.label} · ${current.unit}`} action={<Select value={metric} onChange={setMetric} options={ordered.map(m=>({value:m.key,label:m.label}))} label="Select metric"/>}>
 {comparison.length?<ResponsiveContainer width="100%" height={265}><BarChart data={comparison} layout="vertical" margin={{top:8,right:24,left:12,bottom:0}}><CartesianGrid stroke="#e3ebf1" strokeDasharray="3 5" horizontal={false}/><XAxis type="number" tick={{fill:'#74899b',fontSize:13}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={120} tick={{fill:'#627b90',fontSize:13}} axisLine={false} tickLine={false}/><Tooltip cursor={{fill:'#eff5f9'}} contentStyle={{background:'#ffffff',border:'1px solid #d7e3eb',borderRadius:10}} formatter={v=>[`${formatValue(v,1)} ${current.unit}`,current.label]}/><Bar dataKey="value" fill="#16a9c5" radius={[0,6,6,0]} maxBarSize={23}/></BarChart></ResponsiveContainer>:<EmptyState icon={current.icon} title="No verified values available">No station has a valid value for {current.label.toLowerCase()} in the processed project output.</EmptyState>}
 <div className="source-note">{current.source}. Values without a complete or quality-screened result remain blank.</div></Panel></div>
 <Panel title="Available catchment metrics" subtitle="Verified values for the selected basin"><div className="catchment-cards">{metrics.map(m=><button key={m.key} onClick={()=>setMetric(m.key)} className={`catchment-card ${metric===m.key?'active':''}`}><span className="catchment-icon"><m.icon size={17}/></span><span className="catchment-label">{m.label}</span><b>{selected[m.key]==null?<i>Unavailable</i>:<>{formatValue(selected[m.key],m.key==='precipitation'?1:2)} <small>{m.unit}</small></>}</b><small className="catchment-source">{m.source}</small></button>)}</div></Panel>
 <Panel title="Soil characteristics" subtitle="SSURGO hydrologic group and soil property overlays"><EmptyState icon={Layers3} title="No basin-weighted soil overlay available">Hydrologic soil groups, available water capacity, and saturated hydraulic conductivity were not calculated. No soil estimates are displayed.</EmptyState></Panel>
 <div className="source-note page-source">Land cover is the 2024 USGS Annual NLCD service output. Wetland cover requires a complete NWI basin overlay; partial feature pages are excluded. PRISM values are 1991–2020 normals computed over basin grid-cell intersections.</div>
 </>}
