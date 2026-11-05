import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowUpRight, CloudRain, Download, Droplets, Pause, Play, RefreshCw, Snowflake, Thermometer, Waves } from 'lucide-react'
import { getStations } from '../services/data.js'
import { useData } from '../hooks/useData.js'
import { useLiveStations } from '../hooks/LiveStationsContext.jsx'
import { useStationWeather } from '../hooks/useStationWeather.js'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'
import { weatherRows } from '../services/openMeteo.js'
import { ChartDownload, ErrorState, KPI, LiveStationSummary, Loading, PageHeader, Panel, Select, StationMap, StatusChip, formatValue } from '../components.jsx'

const ranges = [
  { value: '7', label: '7 days' }, { value: '30', label: '30 days' },
  { value: '90', label: '90 days' }, { value: '365', label: '12 months' },
  { value: 'all', label: 'All records' },
]
const chartStyle = { grid: '#e4ebf0', tick: { fill: '#73899b', fontSize: 12 }, tooltip: { background: '#fff', border: '1px solid #dce6ed', borderRadius: 9, color: '#29475e' } }
const number = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value)
const labelTime = time => {
  const date = new Date(time)
  return Number.isNaN(date.valueOf()) ? String(time) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
}

export default function Monitoring() {
  const { data, error, loading } = useData(getStations, 'stations')
  const {stationId,setStationId,dateRange,setDateRange}=useWorkspaceState()
  const range=dateRange
  const [timelineIndex,setTimelineIndex]=useState(0)
  const [timelinePlaying,setTimelinePlaying]=useState(false)
  const { snapshot, loading: liveLoading, error: liveError, refresh: refreshLive, refreshing: liveRefreshing } = useLiveStations()
  const station = data?.find(site => site.id === stationId)
  const weatherState = useStationWeather(station)
  const live = snapshot?.stations.find(item => item.stationId === stationId)
  const flow = live?.streamflow
  const weather = weatherState.data
  const historyRows = useMemo(() => {
    const source=station?.discharge||[]
    const count=range==='all'?source.length:Number(range)
    return source.slice(-count)
  },[station,range])
  useEffect(()=>{setTimelineIndex(Math.max(0,historyRows.length-1));setTimelinePlaying(false)},[historyRows])
  useEffect(()=>{
    if(!timelinePlaying)return
    if(timelineIndex>=historyRows.length-1){setTimelinePlaying(false);return}
    const timer=window.setInterval(()=>setTimelineIndex(index=>Math.min(index+1,historyRows.length-1)),850)
    return()=>window.clearInterval(timer)
  },[timelinePlaying,timelineIndex,historyRows.length])
  const timelineRecord=historyRows[timelineIndex]||null
  const hourly = weatherRows(weather)
  const daily = weather?.daily?.time?.map((time, index) => ({
    time,
    forecast: Date.parse(`${time}T23:59:59`) > Date.now(),
    max: weather.daily.temperature_2m_max?.[index] ?? null,
    min: weather.daily.temperature_2m_min?.[index] ?? null,
    rain: weather.daily.rain_sum?.[index] ?? null,
    precipitation: weather.daily.precipitation_sum?.[index] ?? null,
    snow: weather.daily.snowfall_sum?.[index] ?? null,
    label: new Date(`${time}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
  })) || []
  const discharge = useMemo(() => {
    const historical = historyRows.map(row => ({ time: row.date, historical: row.discharge, continuous: null, predicted: null, label: new Date(`${row.date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: range === '365' ? undefined : '2-digit' }) }))
    const point = (time, key, value) => {
      if (time && number(value) != null) historical.push({ time: String(time).slice(0, 10), historical: null, continuous: null, predicted: null, [key]: Number(value), label: labelTime(time) })
    }
    point(flow?.time, 'continuous', flow?.value)
    point(live?.prediction?.valid_time || live?.prediction?.time, 'predicted', live?.prediction?.predicted_discharge)
    return historical
  }, [historyRows, range, flow?.time, flow?.value, live?.prediction])
  const hourlyChart = useMemo(() => hourly.map(row => ({ ...row, forecast: Date.parse(row.time) > Date.now(), label: labelTime(row.time) })), [weather?.fetchedAt])
  const now = Date.now()
  const nextDay = now + 24 * 60 * 60 * 1000
  const recentHourly = hourly.filter(row => Date.parse(row.time) >= now && Date.parse(row.time) < nextDay)
  const currentRow = hourly.reduce((nearest, row) => Math.abs(Date.parse(row.time) - now) < Math.abs(Date.parse(nearest?.time || 0) - now) ? row : nearest, null)
  const rain24 = recentHourly.some(row=>number(row.rain)!=null) ? recentHourly.reduce((sum, row) => sum + (number(row.rain) ?? 0), 0) : null
  const temperature = number(currentRow?.temperature)
  const soil = number(currentRow?.soil01)
  const snowDepth = number(currentRow?.snowDepth)
  const weatherStatus = weatherState.loading ? 'Loading coordinate forecast…' : weatherState.error ? 'Weather model unavailable' : weather ? 'Open-Meteo model estimate' : 'Weather model unavailable'
  const lastLive = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString() : null
  const historicalMaximum = station?.discharge.reduce((best,row)=>number(row.discharge)!=null&&(!best||row.discharge>best.discharge)?row:best,null)
  const rateOfRise = number(live?.rateOfRise)

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} />

  return <>
    <PageHeader eyebrow="HYDROLOGICAL INTELLIGENCE" title="River monitoring" subtitle="Live gauge observations and coordinate-based weather estimates, kept distinct from historical and model outputs." actions={<StatusChip tone={liveError ? 'neutral' : 'blue'}>{liveError ? 'LIVE FEED DELAYED' : 'NETWORK ONLINE'}</StatusChip>} />

    <div className="monitor-command-bar">
      <div className="command-station"><span className="command-icon"><Waves size={18}/></span><div><small>SELECTED MONITORING STATION</small><b>{station?.river} <i>·</i> {station?.name}, {station?.state}</b><span>{station?.id} · {station?.latitude?.toFixed(4)}, {station?.longitude?.toFixed(4)}</span></div></div>
      <div className="command-controls"><Select value={stationId} onChange={setStationId} options={data.map(site=>({value:site.id,label:`${site.id} · ${site.river}`}))} label="Select station"/><Select value={range} onChange={setDateRange} options={ranges} label="Discharge chart time range"/><div className="command-update"><i className={liveError?'delayed':''}/><span><b>{liveError ? 'USGS update delayed' : liveLoading && !snapshot ? 'Connecting to USGS' : 'USGS live feed'}</b><small>{lastLive ? `Last successful update ${lastLive}` : 'No successful update yet'}</small></span></div><button className="icon-action" onClick={()=>{refreshLive(true);weatherState.refresh(true)}} disabled={liveRefreshing||weatherState.refreshing} title="Refresh observations and weather"><RefreshCw size={16} className={liveRefreshing||weatherState.refreshing?'is-spinning':''}/>Refresh</button><button className="icon-action" onClick={()=>downloadStationCsv(station,historyRows,live,hourly)} title="Export selected station records as CSV"><Download size={15}/>Export CSV</button></div>
    </div>

    <div className="hydro-kpis">
      <KPI label="Latest observed discharge" value={formatValue(flow?.value, 0)} suffix={flow?.unit||''} icon={Waves} note={flow?.time ? `USGS continuous · ${labelTime(flow.time)}` : 'USGS 00060 · unavailable'} />
      <KPI label="FLOODCAST prediction" value={live?.prediction?.predicted_discharge == null ? 'Unavailable' : formatValue(number(live.prediction.predicted_discharge), 0)} suffix={live?.prediction?.predicted_discharge == null ? '' : live.prediction.unit || flow?.unit || 'cfs'} icon={Activity} tone="green" note={live?.prediction?.valid_time ? `Model output · valid ${labelTime(live.prediction.valid_time)}` : 'No model prediction is connected'} />
      <KPI label="Rainfall · next 24 h" value={rain24==null ? 'Unavailable' : formatValue(rain24, 1)} suffix={rain24==null ? '' : 'mm'} icon={CloudRain} tone="cyan" note={rain24==null ? weatherStatus : 'Open-Meteo point estimate'} />
      <KPI label="Temperature" value={temperature == null ? 'Unavailable' : formatValue(temperature, 1)} suffix={temperature == null ? '' : '°C'} icon={Thermometer} tone="amber" note={weather ? 'Open-Meteo · selected coordinate' : weatherStatus} />
      <KPI label="Topsoil moisture" value={soil == null ? 'Unavailable' : formatValue(soil, 3)} suffix={soil == null ? '' : 'm³/m³'} icon={Droplets} tone="green" note={weather ? 'Model grid point · 0–1 cm depth' : weatherStatus} />
      <KPI label="Snow depth" value={snowDepth == null ? 'Unavailable' : formatValue(snowDepth, 2)} suffix={snowDepth == null ? '' : 'm'} icon={Snowflake} tone="purple" note={weather ? 'Model estimate · no melt value inferred' : weatherStatus} />
    </div>

    <div className="monitor-grid hydro-map-grid">
      <Panel title="River network" subtitle="Search by station ID, river, station name, or city. Select a site to focus the map and sync details." className="map-panel monitor-map"><StationMap stations={data} selected={stationId} onSelect={setStationId} timelineRecord={timelineRecord} weatherRainfall={rain24==null?null:{value:rain24,fetchedAt:weather?.fetchedAt}}/><div className="timeline-playback"><button className="timeline-play-button" onClick={()=>{if(!timelinePlaying&&timelineIndex>=historyRows.length-1)setTimelineIndex(0);setTimelinePlaying(value=>!value)}} disabled={historyRows.length<2} aria-label={timelinePlaying?'Pause historical playback':'Play historical timeline'}>{timelinePlaying?<Pause size={15}/>:<Play size={15}/>}</button><div className="timeline-control"><div><b>Historical timeline</b><span>{timelineRecord?`${timelineRecord.date} · ${formatValue(timelineRecord.discharge)} cfs · USGS daily mean`:'No historical records available'}</span></div><input type="range" min="0" max={Math.max(0,historyRows.length-1)} value={Math.min(timelineIndex,Math.max(0,historyRows.length-1))} onChange={event=>{setTimelinePlaying(false);setTimelineIndex(Number(event.target.value))}} disabled={historyRows.length<2} aria-label="Historical discharge timeline"/></div></div></Panel>
      <Panel title="Station intelligence" subtitle="Observed gauge data and model output for the selected site" action={<Link className="text-action" to="/catchment">Basin context <ArrowUpRight size={14}/></Link>}>
        {station&&<>
          <div className="detail-title"><span className="river-icon"><Waves size={20}/></span><div><b>{station.river}</b><small>{station.name} · {station.state}</small></div><StatusChip tone="blue">USGS</StatusChip></div>
          <div className="detail-kpis"><div><span>USGS site ID</span><b>{station.id}</b></div><div><span>Coordinates</span><b>{station.latitude?.toFixed(4)}, {station.longitude?.toFixed(4)}</b></div><div><span>Drainage area</span><b>{formatValue(station.drainageArea)} sq mi</b></div><div><span>Last live observation</span><b>{flow?.time ? labelTime(flow.time) : 'Unavailable'}</b></div><div><span>Historical daily mean maximum</span><b>{historicalMaximum?`${formatValue(historicalMaximum.discharge)} cfs · ${historicalMaximum.date}`:'Unavailable'}</b></div><div><span>Rate of discharge rise</span><b>{rateOfRise==null?'Unavailable from latest-only feed':`${formatValue(rateOfRise,2)} ${live.rateOfRiseUnit||'unit unavailable'}${live.rateOfRiseWindow?` · ${live.rateOfRiseWindow}`:''}`}</b></div></div>
          <LiveStationSummary station={station}/>
        </>}
      </Panel>
    </div>

    <div className="analytics-heading"><div><span className="eyebrow"><span className="eyebrow-line"/>SELECTED STATION ANALYTICS</span><h2>{station?.river} <small>· {station?.id}</small></h2><p>Historical gauge records, coordinate-level weather estimates, and any available model output.</p></div><StatusChip tone={weatherState.error?'neutral':'blue'}>{weatherStatus.toUpperCase()}</StatusChip></div>

    <div className="hydro-chart-grid">
      <Panel title="Observed and predicted discharge" subtitle={`USGS daily mean history · ${ranges.find(item=>item.value===range)?.label} · cfs`} action={<div className="panel-actions"><ChartDownload targetId="export-discharge" filename={`floodcast-${stationId}-discharge`}/><Link className="text-action" to="/predictions">Prediction lab <ArrowUpRight size={14}/></Link></div>} className="hydro-chart-large">
        <div id="export-discharge" className="chart-export chart-export-large">{discharge.length>0?<ResponsiveContainer width="100%" height={330}><ComposedChart data={discharge} margin={{top:16,right:16,left:0,bottom:10}}><CartesianGrid stroke={chartStyle.grid} strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={chartStyle.tick} axisLine={false} tickLine={false} minTickGap={32}/><YAxis tick={chartStyle.tick} axisLine={false} tickLine={false} width={58} tickFormatter={value=>Number(value)>=1000?`${(value/1000).toFixed(0)}k`:value}/><Tooltip contentStyle={chartStyle.tooltip} formatter={(value,name)=>[`${Number(value).toLocaleString()} cfs`,name]} labelStyle={{color:'#546f83'}}/><Legend/><Line type="monotone" dataKey="historical" name="Historical daily mean" stroke="#277fc0" strokeWidth={2} dot={false} connectNulls={false}/><Line type="monotone" dataKey="continuous" name="Latest continuous observation" stroke="#1379bd" strokeWidth={0} dot={{r:6,fill:'#1379bd',stroke:'#fff',strokeWidth:2}} connectNulls={false}/><Line type="monotone" dataKey="predicted" name="FLOODCAST prediction" stroke="#24b56b" strokeWidth={0} dot={{r:7,fill:'#24b56b',stroke:'#fff',strokeWidth:2}} connectNulls={false}/>{timelineRecord&&<ReferenceLine x={new Date(`${timelineRecord.date}T12:00:00`).toLocaleDateString([], {month:'short',day:'numeric',year:range==='365'?undefined:'2-digit'})} stroke="#28834f" strokeDasharray="4 4" label={{value:'Timeline',fill:'#28834f',fontSize:12}}/>}{number(live?.risk?.thresholdValue)!=null&&<ReferenceLine y={live.risk.thresholdValue} stroke="#d85757" strokeDasharray="6 5" label={{value:`Verified threshold · ${live.risk.thresholdSource}`,fill:'#a84c4c',fontSize:12}}/>}</ComposedChart></ResponsiveContainer>:<Unavailable title="No discharge history available">Historical local daily records were not available for this station.</Unavailable>}</div>
        <div className="chart-foot"><span><i className="legend-dot blue"/> Historical USGS daily mean · <i className="legend-dot live-dot"/> Latest continuous</span><span>Forecast points appear only when supplied by the FLOODCAST API.</span></div>
      </Panel>

      <WeatherPanel title="Temperature" subtitle="Daily maximum and minimum · recent archive + forecast · °C" loading={weatherState.loading} error={weatherState.error} data={daily} source={weather?.source} refresh={()=>weatherState.refresh(true)} color="amber">
        {daily.some(row=>number(row.max)!=null||number(row.min)!=null)?<ResponsiveContainer width="100%" height={280}><LineChart data={daily} margin={{top:15,right:12,left:0,bottom:10}}><CartesianGrid stroke={chartStyle.grid} strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={chartStyle.tick} axisLine={false} tickLine={false} minTickGap={32}/><YAxis tick={chartStyle.tick} axisLine={false} tickLine={false} width={42} unit="°"/><Tooltip contentStyle={chartStyle.tooltip} formatter={value=>[`${value} °C`]} labelStyle={{color:'#526c81'}}/><Legend/><Line type="monotone" dataKey="max" name="Maximum" stroke="#e88a38" strokeWidth={2.3} dot={false}/><Line type="monotone" dataKey="min" name="Minimum" stroke="#f2bc72" strokeWidth={2} dot={false}/><ReferenceLine x={daily.find(row=>row.forecast)?.label} stroke="#8699a8" strokeDasharray="4 4" label={{value:'Forecast',fill:'#70879a',fontSize:12}}/></LineChart></ResponsiveContainer>:<Unavailable title="Temperature series unavailable">Open-Meteo did not return daily maximum or minimum temperature.</Unavailable>}
      </WeatherPanel>

      <WeatherPanel title="Rainfall" subtitle="Daily rain · recent archive + forecast · mm/day" loading={weatherState.loading} error={weatherState.error} data={daily} source={weather?.source} refresh={()=>weatherState.refresh(true)} color="cyan">
        {daily.some(row=>number(row.rain)!=null)?<ResponsiveContainer width="100%" height={280}><ComposedChart data={daily} margin={{top:15,right:12,left:0,bottom:10}}><CartesianGrid stroke={chartStyle.grid} strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={chartStyle.tick} axisLine={false} tickLine={false} minTickGap={32}/><YAxis tick={chartStyle.tick} axisLine={false} tickLine={false} width={42} unit="mm"/><Tooltip contentStyle={chartStyle.tooltip} formatter={value=>[`${value} mm`]} labelStyle={{color:'#526c81'}}/><Legend/><Bar dataKey="rain" name="Rain" fill="#21b8d0" radius={[4,4,0,0]}/><ReferenceLine x={daily.find(row=>row.forecast)?.label} stroke="#8699a8" strokeDasharray="4 4"/></ComposedChart></ResponsiveContainer>:<Unavailable title="Rainfall series unavailable">Open-Meteo did not return daily rainfall for this selected grid point.</Unavailable>}
      </WeatherPanel>

      <WeatherPanel title="Soil moisture by depth" subtitle="Volumetric water content · recent archive + forecast · m³/m³" loading={weatherState.loading} error={weatherState.error} data={hourlyChart} source={weather?.source} refresh={()=>weatherState.refresh(true)} color="green">
        {hourlyChart.some(row=>number(row.soil01)!=null||number(row.soil39)!=null||number(row.soil927)!=null||number(row.soil2781)!=null)?<ResponsiveContainer width="100%" height={280}><AreaChart data={hourlyChart} margin={{top:15,right:12,left:0,bottom:10}}><CartesianGrid stroke={chartStyle.grid} strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={chartStyle.tick} axisLine={false} tickLine={false} minTickGap={54}/><YAxis domain={[0,'auto']} tick={chartStyle.tick} axisLine={false} tickLine={false} width={42}/><Tooltip contentStyle={chartStyle.tooltip} formatter={(value,name)=>[`${value} m³/m³`,name]} labelStyle={{color:'#526c81'}}/><Legend/><Area type="monotone" dataKey="soil01" name="0–1 cm" stroke="#268550" fill="#43ad72" fillOpacity={.08} connectNulls={false} dot={false}/><Area type="monotone" dataKey="soil39" name="3–9 cm" stroke="#60a968" fill="transparent" connectNulls={false} dot={false}/><Area type="monotone" dataKey="soil927" name="9–27 cm" stroke="#87b85f" fill="transparent" connectNulls={false} dot={false}/><Area type="monotone" dataKey="soil2781" name="27–81 cm" stroke="#afc46d" fill="transparent" connectNulls={false} dot={false}/></AreaChart></ResponsiveContainer>:<Unavailable title="Soil moisture series unavailable">Open-Meteo did not return soil moisture for this selected grid point.</Unavailable>}
      </WeatherPanel>

      <WeatherPanel title="Snow conditions" subtitle="Snowfall · cm; snow depth · m" loading={weatherState.loading} error={weatherState.error} data={daily} source={weather?.source} refresh={()=>weatherState.refresh(true)} color="purple" footer={<SnowmeltIndicator rows={hourlyChart}/> }>
        {hourlyChart.some(row=>number(row.snowDepth)!=null||number(row.snowfall)!=null)?<ResponsiveContainer width="100%" height={280}><ComposedChart data={hourlyChart} margin={{top:15,right:14,left:0,bottom:10}}><CartesianGrid stroke={chartStyle.grid} strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={chartStyle.tick} axisLine={false} tickLine={false} minTickGap={54}/><YAxis yAxisId="depth" tick={chartStyle.tick} axisLine={false} tickLine={false} width={42} unit="m"/><YAxis yAxisId="snow" orientation="right" tick={chartStyle.tick} axisLine={false} tickLine={false} width={42} unit="cm"/><Tooltip contentStyle={chartStyle.tooltip} formatter={(value,name)=>[`${value} ${name==='Snowfall'?'cm':'m'}`,name]} labelStyle={{color:'#526c81'}}/><Legend/><Area yAxisId="depth" type="monotone" dataKey="snowDepth" name="Snow depth" stroke="#8456bf" fill="#9c70cf" fillOpacity={.12} connectNulls={false}/><Bar yAxisId="snow" dataKey="snowfall" name="Snowfall" fill="#b192db" opacity={.8}/></ComposedChart></ResponsiveContainer>:<Unavailable title="Snow data unavailable">No snow depth or snowfall is available for this station at this time. FLOODCAST does not infer a melt quantity.</Unavailable>}
      </WeatherPanel>
    </div>

    <div className="environment-source-note"><span><CloudRain size={15}/><b>Weather-model context</b></span><p>Open-Meteo estimates come from a weather model grid point at the selected station coordinates. They are not direct weather-station readings and do not represent a verified basin-wide average. Past values use the forecast service's recent archive; future values are forecasts.</p><span className="source-time">{weather?.fetchedAt ? `Retrieved ${new Date(weather.fetchedAt).toLocaleString()}` : 'Weather retrieval time unavailable'} · Refresh follows model availability and uses a 2-hour cache.</span></div>
  </>
}

function WeatherPanel({title,subtitle,loading,error,data,refresh,color,source,footer,children}) {
  return <Panel title={title} subtitle={subtitle} className={`environment-chart ${color}`} action={<ChartDownload targetId={`export-${color}`} filename={`floodcast-${title.toLowerCase().replaceAll(' ','-')}`}/>}>
    <div id={`export-${color}`} className="chart-export">{loading&&!data?<div className="weather-chart-state"><span className="spinner"/>Fetching forecast and recent weather…</div>:error&&!data?<div className="weather-chart-state error"><b>{title} unavailable</b><span>{error.message}</span><button className="text-action" onClick={refresh}><RefreshCw size={13}/>Retry weather request</button></div>:data?.length?children:<Unavailable title={`${title} unavailable`}>This parameter was not returned for the selected station coordinate.</Unavailable>}</div>
    {error&&data&&<div className="stale-weather-note">Refresh failed. Showing the last successful coordinate forecast.</div>}
    {footer}
  </Panel>
}

function Unavailable({title,children}) { return <div className="weather-chart-state unavailable-state"><b>{title}</b><span>{children}</span></div> }

function SnowmeltIndicator({rows}) {
  const now=Date.now()
  const closest=target=>rows.filter(row=>number(row.snowDepth)!=null&&number(row.temperature)!=null).reduce((best,row)=>Math.abs(Date.parse(row.time)-target)<Math.abs(Date.parse(best?.time||0)-target)?row:best,null)
  const current=closest(now)
  const previous=closest(now-24*60*60*1000)
  const enough=current&&previous&&Math.abs(Date.parse(current.time)-now)<4*60*60*1000&&Math.abs(Date.parse(previous.time)-(now-24*60*60*1000))<4*60*60*1000
  const decline=enough&&current.temperature>0&&previous.temperature>0&&previous.snowDepth-current.snowDepth>.005?(previous.snowDepth-current.snowDepth)*100:null
  return <div className="snowmelt-note"><Snowflake size={14}/><span><b>{decline==null?'Snowmelt estimate unavailable':'Potential model-derived snowmelt signal'}</b><small>{decline==null?'Requires a paired snow-depth trend and above-freezing model temperatures.':`Modelled snow depth decreased by ${formatValue(decline,1)} cm over about 24 hours while both temperature samples were above 0 °C.`} This is a weather-model-derived indicator, not measured meltwater or snowmelt depth.</small></span></div>
}

function downloadStationCsv(station,historical,live,hourly) {
  if(!station)return
  const rows=[['station_id','river','record_type','measurement','timestamp','value','unit','source','data_status']]
  const add=(type,name,time,value,unit,source,status='unavailable')=>{
    if(value==null||value==='')return
    rows.push([station.id,station.river,type,name,time??'',value,unit??'',source,status??'unavailable'])
  }
  for(const row of historical)add('historical observation','Daily mean discharge',row.date,row.discharge,'cfs','Local project USGS daily mean CSV','historical record')
  add('live observation','Streamflow',live?.streamflow?.time,live?.streamflow?.value,live?.streamflow?.unit,'USGS latest-continuous API',live?.streamflow?.approvalStatus)
  add('live observation','Gauge height',live?.gaugeHeight?.time,live?.gaugeHeight?.value,live?.gaugeHeight?.unit,'USGS latest-continuous API',live?.gaugeHeight?.approvalStatus)
  for(const prediction of live?.predictions?.length?live.predictions:live?.prediction?[live.prediction]:[])add('model prediction','Predicted discharge',prediction.valid_time||prediction.forecast_time||prediction.time,prediction.predicted_discharge,prediction.unit,'FLOODCAST prediction API',prediction.model_name||prediction.model||'model status unavailable')
  for(const row of hourly){
    add('weather model estimate','Temperature',row.time,row.temperature,'°C','Open-Meteo forecast model')
    add('weather model estimate','Precipitation',row.time,row.precipitation,'mm','Open-Meteo forecast model')
    add('weather model estimate','Rainfall',row.time,row.rain,'mm','Open-Meteo forecast model')
    add('weather model estimate','Snowfall',row.time,row.snowfall,'cm','Open-Meteo forecast model')
    add('weather model estimate','Snow depth',row.time,row.snowDepth,'m','Open-Meteo forecast model')
    add('weather model estimate','Soil moisture 0–1 cm',row.time,row.soil01,'m³/m³','Open-Meteo forecast model')
    add('weather model estimate','Soil moisture 3–9 cm',row.time,row.soil39,'m³/m³','Open-Meteo forecast model')
    add('weather model estimate','Soil moisture 9–27 cm',row.time,row.soil927,'m³/m³','Open-Meteo forecast model')
    add('weather model estimate','Soil moisture 27–81 cm',row.time,row.soil2781,'m³/m³','Open-Meteo forecast model')
  }
  const csv=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n')
  const href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor=document.createElement('a');anchor.href=href;anchor.download=`floodcast-${station.id}-observations.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),1000)
}
