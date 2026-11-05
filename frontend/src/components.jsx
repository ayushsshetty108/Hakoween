import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, BadgeCheck, Bell, ChevronDown, Clock3, Download, Layers3, LoaderCircle, MapPin, Maximize2, Menu, Radio, RefreshCw, Search, Waves, X } from 'lucide-react'
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { NAV } from './navigation.js'
import { getBoundary, getStations } from './services/data.js'
import { getStationFlowlines } from './services/nldi.js'
import { liveFreshness, riskColor, USGS_STATION_IDS } from './services/liveStations.js'
import { useLiveStations } from './hooks/LiveStationsContext.jsx'
import { useWorkspaceState } from './hooks/WorkspaceState.jsx'
import { useData } from './hooks/useData.js'

const icon = (color, active = false) => L.divIcon({ className: '', html: `<span class="station-pin ${active ? 'selected' : ''}" style="--pin:${color}"></span>`, iconSize: [22,22], iconAnchor: [11,11] })
export function Sidebar({ mobileOpen, close }) {
  const location=useLocation()
  useEffect(()=>close(),[location.pathname])
  return <aside className={`sidebar ${mobileOpen?'mobile-open':''}`}>
    <div className="brand"><div className="brand-mark"><Waves size={20}/></div><div><strong>FLOOD<span>CAST</span></strong><small>RIVER INTELLIGENCE</small></div><button className="mobile-close" onClick={close} aria-label="Close navigation"><X size={18}/></button></div>
    <div className="nav-label">WORKSPACE</div><nav>{NAV.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`nav-link ${isActive?'active':''}`}><Icon size={17}/><span>{label}</span>{to==='/monitoring'&&<span className="nav-count">04</span>}</NavLink>)}</nav>
    <div className="sidebar-bottom"><div className="system-card"><span className="status-dot"/><div><b>Project data ready</b><small>Local source files detected</small></div><ChevronDown size={14}/></div><div className="profile"><div className="avatar">FC</div><div><b>Floodcast Lab</b><small>Research workspace</small></div><ChevronDown size={14}/></div></div>
  </aside>
}

export function Topbar({ onMenu }) {
  const location=useLocation()
  const {data:stations}=useData(getStations,'global-station-selector')
  const {stationId,setStationId,dateRange,setDateRange}=useWorkspaceState()
  const liveState=useLiveStations()
  const today=new Intl.DateTimeFormat('en-US',{month:'short',day:'2-digit',year:'numeric'}).format(new Date()).toUpperCase()
  const label=location.pathname==='/monitoring'?'LIVE + MODEL DATA':'HISTORICAL DATA'
  const dateOptions=[{value:'7',label:'7 days'},{value:'30',label:'30 days'},{value:'90',label:'90 days'},{value:'365',label:'12 months'},{value:'all',label:'All records'}]
  return <header className="topbar"><button className="mobile-menu" onClick={onMenu} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{NAV.find(n=>n.to===location.pathname)?.label||'Overview'}</strong></div><div className="top-actions"><div className="global-tools"><Select value={stationId} onChange={setStationId} options={(stations||[]).map(site=>({value:site.id,label:site.id}))} label="Global station"/><Select value={dateRange} onChange={setDateRange} options={dateOptions} label="Global date range"/></div><NotificationCenter stations={stations||[]} snapshot={liveState.snapshot} error={liveState.error}/><span className="live-status"><i/> {label}</span><div className="top-divider"/><div className="date-label">{today}</div></div></header>
}

function NotificationCenter({stations,snapshot,error}) {
  const [open,setOpen]=useState(false)
  const items=[]
  if(!snapshot&&error)items.push({key:'feed',title:'Live feed unavailable',detail:error.message,tone:'warning'})
  for(const site of stations){
    const row=snapshot?.stations.find(item=>item.stationId===site.id)
    if(!row)continue
    if(row.streamflow?.value==null)items.push({key:`missing-${site.id}`,title:'Missing discharge measurement',detail:`${site.river} · ${site.id} has no returned continuous reading.`,tone:'warning'})
    else {
      const freshness=liveFreshness(row.streamflow)
      if(freshness.stale)items.push({key:`stale-${site.id}`,title:'Stale station measurement',detail:`${site.river} · ${freshness.label}.`,tone:'warning'})
      if(Number.isFinite(row.risk?.thresholdValue)&&row.risk.thresholdSource&&Number(row.streamflow.value)>=row.risk.thresholdValue)items.push({key:`threshold-${site.id}`,title:'Verified threshold exceeded',detail:`${site.river} · ${row.streamflow.value} ${row.streamflow.unit||''} meets/exceeds ${row.risk.thresholdValue} ${row.risk.thresholdUnit||row.streamflow.unit||''}. Source: ${row.risk.thresholdSource}.`,tone:'danger'})
      if(row.rapidRiseAlert)items.push({key:`rise-${site.id}`,title:'Rapid discharge increase',detail:`${site.river} · flagged by the connected backend.`,tone:'warning'})
      if(row.unusualObservation)items.push({key:`unusual-${site.id}`,title:'Unusual observation',detail:`${site.river} · flagged by the connected backend.`,tone:'warning'})
    }
  }
  return <div className="notification-center"><button className="notification-trigger" onClick={()=>setOpen(value=>!value)} aria-label={`Notifications, ${items.length} active`} aria-expanded={open} aria-haspopup="dialog"><Bell size={16}/>{items.length>0&&<span>{items.length}</span>}</button>{open&&<div className="notification-popover" role="dialog" aria-label="Current station notifications"><div className="notification-head"><div><b>Current notifications</b><small>{items.length} requiring review</small></div><button onClick={()=>setOpen(false)} aria-label="Close notifications"><X size={15}/></button></div>{items.length?items.map(item=><div key={item.key} className={`notification-item ${item.tone}`}><i/><div><b>{item.title}</b><span>{item.detail}</span></div></div>):<div className="notifications-clear"><BadgeCheck size={18}/><b>No active notifications</b><span>All available station measurements are current.</span></div>}<div className="notification-foot">Active conditions only. Persisted alert history is unavailable until a backend alert-history feed is connected.</div></div>}</div>
}

export function PageHeader({ eyebrow, title, subtitle, actions }) { return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{actions&&<div className="heading-actions">{actions}</div>}</div> }
export function Panel({ title, subtitle, action, children, className='' }) { return <section className={`panel ${className}`}><div className="panel-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>{children}</section> }
export function ChartDownload({ targetId, filename='floodcast-chart' }) {
  async function download() {
    const svg=document.getElementById(targetId)?.querySelector('svg.recharts-surface')
    if(!svg)return
    const clone=svg.cloneNode(true)
    const box=svg.getBoundingClientRect()
    const width=Math.max(640,Math.round(box.width||svg.viewBox.baseVal.width||640))
    const height=Math.max(320,Math.round(box.height||svg.viewBox.baseVal.height||320))
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(width));clone.setAttribute('height',String(height))
    const background=document.createElementNS('http://www.w3.org/2000/svg','rect');background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','#ffffff');clone.insertBefore(background,clone.firstChild)
    const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'})
    const source=URL.createObjectURL(blob)
    try {
      const image=new Image()
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source})
      const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2
      const context=canvas.getContext('2d');context.scale(2,2);context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height)
      const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
      if(!png)throw new Error('Chart image export failed')
      const href=URL.createObjectURL(png);const anchor=document.createElement('a');anchor.href=href;anchor.download=`${filename}.png`;anchor.click();URL.revokeObjectURL(href)
    } catch { const anchor=document.createElement('a');anchor.href=source;anchor.download=`${filename}.svg`;anchor.click() }
    finally { URL.revokeObjectURL(source) }
  }
  return <button className="chart-download-button" type="button" onClick={download} title="Download chart as an image"><Download size={13}/><span>PNG</span></button>
}
export function KPI({ label, value, suffix, icon:Icon, note, tone='blue' }) { return <div className="kpi-card"><div className="kpi-top"><span>{label}</span><span className={`kpi-icon ${tone}`}><Icon size={17}/></span></div><div className="kpi-value">{value}{suffix&&<small>{suffix}</small>}</div><div className="kpi-note">{note}</div></div> }
export function Loading() { return <div className="loading"><span className="spinner"/>Loading verified project data…</div> }
export function EmptyState({ title='Not available yet', children, icon:Icon=Layers3 }) { return <div className="empty-state"><div className="empty-icon"><Icon size={20}/></div><b>{title}</b><p>{children}</p></div> }
export function ErrorState({ error }) { return <div className="inline-error"><Radio size={17}/><span>{error?.message || 'This project dataset could not be loaded.'}</span></div> }
export function Select({ value, onChange, options, label }) { return <label className="select-wrap"><span className="sr-only">{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><ChevronDown size={14}/></label> }
function BoundaryOverlay({ stationId }) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true)
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');getBoundary(stationId).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[stationId])
  if (loading) return <div className="map-loading"><LoaderCircle size={15}/>Loading basin boundary…</div>
  if (error) return <div className="map-loading map-error">{error}</div>
  return data?<GeoJSON data={data} style={{color:'#1676c4',weight:2.2,opacity:.95,fillColor:'#57b7ec',fillOpacity:.1,dashArray:'6 5'}}/>:null
}
function RiverNetworkOverlay({ stationId }) {
  const [data,setData]=useState(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true)
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');getStationFlowlines(stationId).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[stationId])
  if(loading)return <div className="map-loading">Loading nearby USGS river reaches…</div>
  if(error)return <div className="map-loading map-error">River network unavailable · {error}</div>
  return data?<GeoJSON data={data} style={{color:'#23b3ce',weight:3,opacity:.9}}/>:null
}
const RISK_COLORS={normal:'#369b64',moderate:'#dfb735',high:'#e58a32',severe:'#d94f55',neutral:'#71879a'}
const readableValue=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(value))
function StationMarker({ station, selected, onSelect, markerRefs, timelineRecord }) {
  const {snapshot}=useLiveStations()
  const live=snapshot?.stations.find(item=>item.stationId===station.id)
  const state=riskColor(live?.risk)
  const markerColor=RISK_COLORS[state]
  const stream=live?.streamflow
  const height=live?.gaugeHeight
  const freshness=liveFreshness(stream)
  return <Marker ref={instance=>{if(instance)markerRefs.current[station.id]=instance;else delete markerRefs.current[station.id]}} position={[station.latitude,station.longitude]} icon={icon(markerColor, selected===station.id)} eventHandlers={{click:()=>onSelect?.(station.id)}}>
    <Popup><div className="map-popup live-popup">
      <div className="popup-heading"><span className="popup-station-icon"><MapPin size={15}/></span><div><b>{station.river}</b><span>{station.id} · {station.name}</span></div></div>
      <div className="popup-location">{station.state} · {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</div>
      <div className="popup-live-grid">
        <div><small>Observed streamflow</small><b>{readableValue(stream?.value)} <i>{stream?.unit||''}</i></b><span>{stream?.time?new Date(stream.time).toLocaleString():'No live observation returned'}</span><em>USGS observation · {stream?.approvalStatus||'status unavailable'}</em></div>
        <div><small>Observed gauge height</small><b>{readableValue(height?.value)} <i>{height?.unit||''}</i></b><span>{height?.time?new Date(height.time).toLocaleString():'Not reported by this station'}</span></div>
      </div>
      {selected===station.id&&timelineRecord&&<div className="popup-timeline"><span>Historical timeline · USGS daily mean</span><b>{new Intl.NumberFormat('en-US').format(timelineRecord.discharge)} cfs</b><small>{timelineRecord.date}</small></div>}
      <div className="popup-status"><Clock3 size={13}/><span>{freshness.label}</span><b>{riskColor(live?.risk)==='neutral'?'Risk classification unavailable':`${live.risk.classification} · ${live.risk.thresholdSource}`}</b></div>
      <div className="popup-prediction"><span>FLOODCAST predicted discharge</span><b>{live?.prediction?.predicted_discharge!=null?`${readableValue(live.prediction.predicted_discharge)} ${live.prediction.unit||stream?.unit||''}`:'No validated prediction available'}</b></div>
    </div></Popup>
  </Marker>
}
function LiveMapBadge(){const {snapshot,loading,refreshing,error,refresh}=useLiveStations();const time=snapshot?.fetchedAt?new Date(snapshot.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):null;return <div className={`live-map-badge ${error?'warning':''}`}><span className="live-map-dot"/><span>{error?(snapshot?'USGS update delayed':'Live USGS unavailable'):snapshot?.source||'Connecting to USGS'}</span><span className="live-map-updated">{time?`Updated ${time}`:loading?'Loading latest observations':'No successful update'}</span><button onClick={()=>refresh(true)} disabled={refreshing||loading} aria-label="Refresh live station measurements" title={error?.message||'Refresh live data'}><RefreshCw size={13} className={refreshing?'is-spinning':''}/></button></div>}
export function LiveStationSummary({ station }) {
  const {snapshot,loading,error,refreshing,refresh}=useLiveStations()
  const live=snapshot?.stations.find(item=>item.stationId===station.id)
  const stream=live?.streamflow;const height=live?.gaugeHeight;const freshness=liveFreshness(stream)
  return <div className="live-summary">
    <div className="live-summary-head"><div><span className="live-kicker"><i/>{error&&snapshot?'LAST SUCCESSFUL DATA · UPDATE DELAYED':snapshot?.source||'CONNECTING TO USGS'}</span><h3>Latest continuous reading</h3></div><button className="refresh-button" onClick={()=>refresh(true)} disabled={refreshing||loading} aria-label="Refresh live station data"><RefreshCw size={14} className={refreshing?'is-spinning':''}/> Refresh</button></div>
    {loading&&!snapshot?<div className="live-empty"><LoaderCircle size={17}/>Requesting latest measurements from USGS…</div>:<>
      <div className="live-measurement-grid"><div className="live-measurement primary"><span>Observed streamflow <em>USGS · 00060</em></span><b>{readableValue(stream?.value)} <small>{stream?.unit||''}</small></b><span>{stream?.time?new Date(stream.time).toLocaleString():'No continuous flow reading returned'}</span><span className="approval-status">{stream?.approvalStatus||'Approval status unavailable'}</span></div><div className="live-measurement"><span>Observed gauge height <em>USGS · 00065</em></span><b>{readableValue(height?.value)} <small>{height?.unit||''}</small></b><span>{height?.time?new Date(height.time).toLocaleString():'Not reported for this station'}</span><span className="approval-status">{height?.approvalStatus||'Approval status unavailable'}</span></div></div>
      <div className="live-detail-meta"><span className={freshness.stale?'stale':''}><Clock3 size={13}/>{freshness.label}</span><span><BadgeCheck size={13}/>{stream?.approvalStatus||'Data status unavailable'}</span></div>
      <div className="live-prediction-row"><span>FLOODCAST predicted discharge</span><b>{live?.prediction?.predicted_discharge!=null?`${readableValue(live.prediction.predicted_discharge)} ${live.prediction.unit||stream?.unit||''}`:'No validated prediction available'}</b><small>Predictions are kept separate from USGS observations.</small></div>
      {riskColor(live?.risk)==='neutral'?<div className="risk-unavailable"><AlertCircle size={14}/><span>Risk classification unavailable — no verified station-specific flood thresholds are connected.</span></div>:<div className={`risk-supported ${riskColor(live.risk)}`}><span>Threshold-based risk</span><b>{live.risk.classification}</b><small>{live.risk.thresholdSource}</small></div>}
    </>}
    {error&&<div className="live-error"><AlertCircle size={14}/><span>{error.message}</span></div>}
  </div>
}
const SEARCH_ALIASES = {
  '01646500': 'washington washington dc district of columbia',
  '02087500': 'clayton north carolina',
  '07010000': 'st louis saint louis missouri',
  '08158000': 'austin texas',
}
const STATION_CITY = { '01646500':'Washington, DC area', '02087500':'Clayton, NC', '07010000':'St. Louis, MO', '08158000':'Austin, TX' }

function MapSelectionController({ station, markerRefs, selectionVersion }) {
  const map = useMap()
  const previous = useRef({stationId:station?.id,selectionVersion})
  useEffect(() => {
    if (previous.current.stationId===station?.id&&previous.current.selectionVersion===selectionVersion)return
    previous.current={stationId:station?.id,selectionVersion}
    if (!station || !Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) return
    map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 8), { duration: 0.75 })
    const timer = window.setTimeout(() => markerRefs.current[station.id]?.openPopup(), 800)
    return () => window.clearTimeout(timer)
  }, [map, station?.id, selectionVersion])
  return null
}

export function StationMap({ stations, selected, onSelect, timelineRecord, weatherRainfall }) {
  const [layer,setLayer]=useState('street')
  const [mapDataMode,setMapDataMode]=useState('stations')
  const [showBoundary,setShowBoundary]=useState(false)
  const [showRiverNetwork,setShowRiverNetwork]=useState(false)
  const [query,setQuery]=useState('')
  const [searchOpen,setSearchOpen]=useState(false)
  const [selectionVersion,setSelectionVersion]=useState(0)
  const [fullScreen,setFullScreen]=useState(false)
  const markerRefs=useRef({})
  const mapShell=useRef(null)
  const selectedSite=stations.find(site=>site.id===selected)
  const normalized=query.trim().toLowerCase()
  const matches=normalized?stations.filter(site=>`${site.id} ${site.river} ${site.name} ${site.state} ${SEARCH_ALIASES[site.id]||''}`.toLowerCase().includes(normalized)):stations

  useEffect(()=>{
    const update=()=>setFullScreen(document.fullscreenElement===mapShell.current)
    document.addEventListener('fullscreenchange',update)
    return()=>document.removeEventListener('fullscreenchange',update)
  },[])

  function selectStation(id) {
    onSelect?.(id)
    setSelectionVersion(version=>version+1)
    const site=stations.find(station=>station.id===id)
    if(site)setQuery(`${site.id} · ${site.river}`)
    setSearchOpen(false)
  }

  async function toggleFullscreen() {
    if(document.fullscreenElement) await document.exitFullscreen?.()
    else await mapShell.current?.requestFullscreen?.()
  }

  return <>
    <div className="station-map-toolbar">
      <div className="station-search-wrap">
        <Search size={16}/>
        <input value={query} onChange={event=>{setQuery(event.target.value);setSearchOpen(true)}} onFocus={()=>setSearchOpen(true)} onKeyDown={event=>{if(event.key==='Escape')setSearchOpen(false);if(event.key==='Enter'&&matches[0])selectStation(matches[0].id)}} placeholder="Search station, river, or city" aria-label="Search stations by ID, river, station name, or city" aria-expanded={searchOpen}/>
        {query&&<button aria-label="Clear station search" onClick={()=>{setQuery('');setSearchOpen(true)}}><X size={14}/></button>}
        {searchOpen&&<div className="station-search-results" role="listbox" aria-label="Matching stations">{matches.length?matches.map(site=><button key={site.id} role="option" aria-selected={site.id===selected} onMouseDown={event=>event.preventDefault()} onClick={()=>selectStation(site.id)}><MapPin size={14}/><span><b>{site.river}</b><small>{site.id} · {site.name} · {STATION_CITY[site.id]}</small></span></button>):<div className="search-no-results">No matching station. Try an ID, river, or city.</div>}</div>}
      </div>
      <Select value={selected} onChange={selectStation} options={stations.map(site=>({value:site.id,label:`${site.id} · ${site.river}`}))} label="Select monitoring station"/>
      <Select value={mapDataMode} onChange={setMapDataMode} options={[{value:'stations',label:'Station markers'},{value:'discharge',label:'Live discharge'},{value:'rainfall',label:'Forecast rainfall'}]} label="Map measurement layer"/>
      <Select value={layer} onChange={setLayer} options={[{value:'street',label:'Street map'},{value:'satellite',label:'Satellite view'},{value:'terrain',label:'Terrain'}]} label="Basemap"/>
    </div>
    <div className={`map-wrap ${layer==='street'?'dark-map':'light-map'} ${fullScreen?'map-fullscreen':''}`} ref={mapShell}>
      <MapContainer center={[38,-91]} zoom={4} scrollWheelZoom={true} zoomControl={true}>
        {layer==='street'
          ? <TileLayer key="street" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"/>
          : layer==='satellite'
            ? <TileLayer key="satellite" attribution='Tiles &copy; Esri — Sources: <a href="https://www.esri.com/en-us/legal/terms/full-master-agreement">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>
            : <TileLayer key="terrain" attribution='Tiles &copy; Esri — Sources: Esri, USGS, NOAA, and other contributors' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"/>}
        {showBoundary&&selected&&<BoundaryOverlay key={selected} stationId={selected}/>}
        {showRiverNetwork&&selected&&<RiverNetworkOverlay key={`river-${selected}`} stationId={selected}/>}
        <MapSelectionController station={selectedSite} markerRefs={markerRefs} selectionVersion={selectionVersion}/>
        {stations.filter(site=>USGS_STATION_IDS.includes(site.id)&&Number.isFinite(site.latitude)&&Number.isFinite(site.longitude)).map(site=><StationMarker key={site.id} station={site} selected={selected} onSelect={id=>selectStation(id)} markerRefs={markerRefs} timelineRecord={timelineRecord}/>)}
        {mapDataMode==='discharge'&&<DischargeOverlay stations={stations} onSelect={selectStation}/>}
        {mapDataMode==='rainfall'&&selectedSite&&Number.isFinite(weatherRainfall?.value)&&<CircleMarker center={[selectedSite.latitude,selectedSite.longitude]} radius={Math.min(45,10+Math.sqrt(Math.max(0,weatherRainfall.value))*5)} pathOptions={{color:'#079db6',weight:2,fillColor:'#23bfd0',fillOpacity:.3}} eventHandlers={{click:()=>selectStation(selectedSite.id)}}><Popup><div className="map-popup"><b>Forecast rainfall · {selectedSite.river}</b><span>{formatValue(weatherRainfall.value,1)} mm expected in the next 24 h</span><span>Open-Meteo model at the selected station coordinate · {weatherRainfall.fetchedAt?new Date(weatherRainfall.fetchedAt).toLocaleString():'retrieval time unavailable'}</span><small>Point estimate; not a basin-wide rainfall surface.</small></div></Popup></CircleMarker>}
      </MapContainer>
      <LiveMapBadge/>
      <div className="map-tools">
        <button className={`boundary-toggle ${showBoundary?'selected':''}`} onClick={()=>setShowBoundary(value=>!value)} aria-pressed={showBoundary} disabled={!selected} title="Toggle verified watershed boundary"><Layers3 size={14}/><span>{showBoundary?'Hide basin':'Basin outline'}</span></button>
        <button className={`boundary-toggle river-toggle ${showRiverNetwork?'selected':''}`} onClick={()=>setShowRiverNetwork(value=>!value)} aria-pressed={showRiverNetwork} disabled={!selected} title="Load bounded upstream and downstream river reaches"><Waves size={14}/><span>{showRiverNetwork?'Hide reaches':'River network'}</span></button>
        <button className="boundary-toggle map-fullscreen-button" onClick={toggleFullscreen} aria-label={fullScreen?'Exit fullscreen map':'Open fullscreen map'} title={fullScreen?'Exit fullscreen':'Fullscreen map'}><Maximize2 size={14}/><span>{fullScreen?'Exit':'Fullscreen'}</span></button>
      </div>
      {mapDataMode==='rainfall'&&<div className="map-data-note">{Number.isFinite(weatherRainfall?.value)?`Next 24 h model rainfall · ${formatValue(weatherRainfall.value,1)} mm at selected point`:'Select a station in Monitoring to load its point rainfall estimate.'}</div>}
      {showBoundary&&selectedSite&&<div className="boundary-note">Verified NLDI boundary · {selectedSite.id}{selectedSite.id==='07010000'?' · large basin file, loads on request':''}</div>}
      <div className="map-legend risk-legend"><span><i className="legend-dot risk-normal"/>Normal</span><span><i className="legend-dot risk-moderate"/>Moderate</span><span><i className="legend-dot risk-high"/>High</span><span><i className="legend-dot risk-severe"/>Severe</span><span><i className="legend-dot risk-neutral"/>Risk unavailable</span>{showBoundary&&<span><i className="legend-line"/>Verified basin</span>}{showRiverNetwork&&<span><i className="legend-line river-line"/>USGS river reach</span>}</div>
    </div>
  </>
}

function DischargeOverlay({stations,onSelect}) {
  const {snapshot}=useLiveStations()
  const values=stations.map(site=>({site,reading:snapshot?.stations.find(item=>item.stationId===site.id)?.streamflow})).filter(item=>Number.isFinite(Number(item.reading?.value)))
  const max=Math.max(1,...values.map(item=>Number(item.reading.value)))
    return values.map(({site,reading})=><CircleMarker key={`flow-${site.id}`} center={[site.latitude,site.longitude]} radius={8+14*Math.sqrt(Math.max(0,Number(reading.value))/max)} pathOptions={{color:'#125d91',weight:2,fillColor:'#168fc6',fillOpacity:.45}} eventHandlers={{click:()=>onSelect(site.id)}}><Popup><div className="map-popup"><b>Observed discharge · {site.river}</b><span>{new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(reading.value))} {reading.unit||'unit unavailable'}</span><span>{reading.time?new Date(reading.time).toLocaleString():'Timestamp unavailable'} · USGS 00060</span></div></Popup></CircleMarker>)
}
export function formatValue(value, digits=0) { return value==null||!Number.isFinite(value)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value) }
export function StatusChip({ children, tone='neutral' }) { return <span className={`status-chip ${tone}`}>{children}</span> }
