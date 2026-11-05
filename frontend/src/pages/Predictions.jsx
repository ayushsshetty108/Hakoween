import { useMemo } from 'react'
import { Activity, ChartNoAxesCombined, Clock3, Gauge, Waves } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getStations } from '../services/data.js'
import { useData } from '../hooks/useData.js'
import { useLiveStations } from '../hooks/LiveStationsContext.jsx'
import { useWorkspaceState } from '../hooks/WorkspaceState.jsx'
import { ChartDownload, EmptyState, ErrorState, Loading, PageHeader, Panel, Select, StatusChip, formatValue } from '../components.jsx'

const windows=[{value:'7',label:'Last 7 days'},{value:'30',label:'Last 30 days'},{value:'90',label:'Last 90 days'},{value:'365',label:'Last 12 months'},{value:'all',label:'All available'}]
const numeric=value=>value==null||!Number.isFinite(Number(value))?null:Number(value)
const timestamp=value=>value?new Date(value).toLocaleString():'Unavailable'

export default function Predictions() {
  const {data,error,loading}=useData(getStations,'stations')
  const {snapshot,loading:liveLoading,error:liveError}=useLiveStations()
  const {stationId,setStationId,dateRange,setDateRange}=useWorkspaceState()
  const id=stationId
  const range=dateRange
  const station=data?.find(site=>site.id===id)
  const live=snapshot?.stations.find(site=>site.stationId===id)
  const currentPrediction=live?.prediction
  const predictionRows=live?.predictions?.length?live.predictions:currentPrediction?[currentPrediction]:[]
  const history=useMemo(()=>{
    const records=station?.discharge||[]
    const count=range==='all'?records.length:Number(range)
    return records.slice(-count)
  },[station,range])
  const graph=useMemo(()=>{
    const dates=new Map(history.map(row=>[row.date,{date:row.date,actual:row.discharge,predicted:null,label:new Date(`${row.date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:range==='365'?undefined:'2-digit'})}]))
    for(const row of predictionRows){
      const validTime=row.valid_time||row.forecast_time||row.time
      const predicted=numeric(row.predicted_discharge??row.prediction)
      if(!validTime||predicted==null)continue
      const date=String(validTime).slice(0,10)
      const point=dates.get(date)||{date,actual:null,predicted:null,label:new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})}
      if(numeric(row.observed_discharge??row.actual_discharge)!=null)point.actual=numeric(row.observed_discharge??row.actual_discharge)
      point.predicted=predicted
      dates.set(date,point)
    }
    return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))
  },[history,predictionRows,range])
  const matched=graph.filter(row=>numeric(row.actual)!=null&&numeric(row.predicted)!=null)
  const mae=matched.length?matched.reduce((sum,row)=>sum+Math.abs(row.predicted-row.actual),0)/matched.length:null
  const threshold=numeric(live?.risk?.thresholdValue)
  const horizon=currentPrediction?.horizon_hours!=null?`${currentPrediction.horizon_hours} hours`:currentPrediction?.horizon_days!=null?`${currentPrediction.horizon_days} days`:currentPrediction?.horizon||'Unavailable'
  const generated=currentPrediction?.generated_at||currentPrediction?.prediction_time||currentPrediction?.created_at
  const validTime=currentPrediction?.valid_time||currentPrediction?.forecast_time||currentPrediction?.time
  const modelName=currentPrediction?.model_name||currentPrediction?.model||'Model metadata unavailable'
  const explanation=currentPrediction?.feature_importance??currentPrediction?.feature_importances??null
  const importanceEntries=Array.isArray(explanation)?explanation.map(item=>({name:item.feature||item.name||item.input||'Input',score:numeric(item.importance??item.score??item.value)})).filter(item=>item.score!=null):explanation&&typeof explanation==='object'?Object.entries(explanation).map(([name,score])=>({name,score:numeric(score)})).filter(item=>item.score!=null):[]
  const maxImportance=Math.max(0,...importanceEntries.map(item=>item.score))
  const uncertainty=currentPrediction?.uncertainty
  const calibratedInterval=uncertainty?.calibrated===true&&numeric(uncertainty.lower??uncertainty.lower_bound)!=null&&numeric(uncertainty.upper??uncertainty.upper_bound)!=null

  if(loading)return <Loading/>
  if(error)return <ErrorState error={error}/>
  return <>
    <PageHeader eyebrow="FLOODCAST MODEL OUTPUT" title="Discharge predictions" subtitle="Compare measured river flow with returned FLOODCAST predictions. Forecast values are displayed only when the backend provides them." actions={<StatusChip tone={currentPrediction?'blue':'neutral'}>{currentPrediction?'MODEL OUTPUT AVAILABLE':'PREDICTION FEED UNAVAILABLE'}</StatusChip>}/>
    <div className="filter-bar"><div className="filter-label"><span className="filter-icon"><Waves size={16}/></span><div><b>Prediction verification</b><small>Observed USGS flow remains separate from ML output</small></div></div><div className="filters"><Select value={id} onChange={setStationId} options={data.map(site=>({value:site.id,label:`${site.id} · ${site.river}`}))} label="Choose station"/><Select value={range} onChange={setDateRange} options={windows} label="Historical date range"/></div></div>

    <div className="kpi-grid four prediction-kpis">
      <div className="kpi-card"><div className="kpi-top"><span>Latest observed flow</span><span className="kpi-icon blue"><Waves size={17}/></span></div><div className="kpi-value">{formatValue(numeric(live?.streamflow?.value))}<small>{live?.streamflow?.unit||'cfs'}</small></div><div className="kpi-note">USGS continuous · {timestamp(live?.streamflow?.time)}</div></div>
      <div className="kpi-card"><div className="kpi-top"><span>Predicted discharge</span><span className="kpi-icon green"><Activity size={17}/></span></div><div className="kpi-value">{currentPrediction&&numeric(currentPrediction.predicted_discharge)!=null?formatValue(numeric(currentPrediction.predicted_discharge)):'Unavailable'}<small>{currentPrediction?.unit||live?.streamflow?.unit||''}</small></div><div className="kpi-note">{currentPrediction?`Valid ${timestamp(validTime)}`:liveLoading?'Checking model feed…':'No prediction returned'}</div></div>
      <div className="kpi-card"><div className="kpi-top"><span>Mean absolute error</span><span className="kpi-icon amber"><ChartNoAxesCombined size={17}/></span></div><div className="kpi-value">{mae==null?'Unavailable':formatValue(mae,1)}<small>{mae==null?'':'cfs'}</small></div><div className="kpi-note">{matched.length?`${matched.length} same-date matched records`:'No matched observed/predicted dates'}</div></div>
      <div className="kpi-card"><div className="kpi-top"><span>Forecast horizon</span><span className="kpi-icon"><Clock3 size={17}/></span></div><div className="kpi-value small-value">{currentPrediction?horizon:'Unavailable'}</div><div className="kpi-note">No forecast extension is assumed.</div></div>
    </div>

    {liveError&&<div className="inline-error prediction-error"><Activity size={16}/><span>{liveError.message}</span></div>}

    <Panel title="Actual versus predicted discharge" subtitle={`${station?.river} · ${id} · cubic feet per second`} action={<div className="panel-actions"><ChartDownload targetId="prediction-comparison" filename={`floodcast-${id}-prediction-lab`}/><span className="chart-tag"><i/> OBSERVED + MODEL OUTPUT</span></div>}>
      <div id="prediction-comparison" className="chart-export chart-export-large">{graph.length?<ResponsiveContainer width="100%" height={390}><LineChart data={graph} margin={{top:18,right:16,left:0,bottom:10}}><CartesianGrid stroke="#e3ebf1" strokeDasharray="4 5" vertical={false}/><XAxis dataKey="label" tick={{fill:'#74899b',fontSize:13}} tickLine={false} axisLine={false} minTickGap={38}/><YAxis tick={{fill:'#74899b',fontSize:13}} tickLine={false} axisLine={false} width={58} tickFormatter={value=>Number(value)>=1000?`${(value/1000).toFixed(0)}k`:value}/><Tooltip contentStyle={{background:'#fff',border:'1px solid #d7e3eb',borderRadius:10,color:'#1e3c54'}} formatter={(value,name)=>[`${Number(value).toLocaleString()} cfs`,name]} labelStyle={{color:'#627b90'}}/><Legend/><Line type="monotone" dataKey="actual" name="Observed USGS daily mean" stroke="#267fc0" strokeWidth={2} dot={false} connectNulls={false}/><Line type="monotone" dataKey="predicted" name="FLOODCAST predicted discharge" stroke="#21ad65" strokeWidth={2.5} dot={{r:5,fill:'#21ad65',stroke:'#fff',strokeWidth:2}} connectNulls={false}/>{threshold!=null&&<ReferenceLine y={threshold} stroke="#d65050" strokeDasharray="7 5" label={{value:`Verified threshold · ${live.risk.thresholdSource}`,fill:'#a34c4c',fontSize:12}}/>}</LineChart></ResponsiveContainer>:<EmptyState icon={ChartNoAxesCombined} title="No discharge series available">No historical station records were available for this selection.</EmptyState>}</div>
      <div className="chart-foot"><span><i className="legend-dot blue"/> Actual daily mean <i className="legend-dot prediction-dot"/> FLOODCAST prediction {threshold!=null&&<><i className="legend-line risk-line"/> Verified station threshold</>}</span><span>Prediction error uses same-date pairs only.</span></div>
    </Panel>

    <div className="prediction-grid"><Panel title="Model details" subtitle="Prediction provenance and timing"><div className="prediction-meta-grid"><Meta label="Model" value={currentPrediction?modelName:'Unavailable'}/><Meta label="Prediction generated" value={timestamp(generated)}/><Meta label="Valid time" value={timestamp(validTime)}/><Meta label="Forecast horizon" value={horizon}/><Meta label="Prediction records" value={formatValue(predictionRows.filter(row=>numeric(row.predicted_discharge??row.prediction)!=null).length)}/><Meta label="Calibrated uncertainty" value={calibratedInterval?`${uncertainty.lower??uncertainty.lower_bound}–${uncertainty.upper??uncertainty.upper_bound} ${currentPrediction?.unit||'cfs'}`:'Unavailable or not calibrated'}/><Meta label="Live feed" value={snapshot?.source||'Not connected'}/></div>{!currentPrediction&&<div className="risk-unavailable prediction-unavailable"><ChartNoAxesCombined size={15}/><span>The prediction endpoint is not connected or has not returned a validated output for this station. The chart contains observed history only; no forecast values are fabricated.</span></div>}</Panel><Panel title="Prediction verification" subtitle="Matched observed and predicted dates">{matched.length?<div className="verification-summary"><div><small>Mean absolute error</small><b>{formatValue(mae,1)} cfs</b></div><div><small>Matched records</small><b>{matched.length}</b></div><div><small>Latest matched date</small><b>{matched.at(-1)?.date}</b></div><p>Absolute error is calculated only for dates with both a FLOODCAST prediction and an observed USGS daily mean.</p></div>:<EmptyState icon={Gauge} title="Verification unavailable">No date-matched prediction and actual flow values are available for this station. Error metrics remain blank until both exist.</EmptyState>}</Panel><Panel title="AI prediction explanation" subtitle="Backend-returned feature importance and model inputs">{importanceEntries.length?<><p className="importance-note">Bars show relative contribution compared with the largest returned feature; values are the model payload values.</p><div className="importance-list">{importanceEntries.sort((a,b)=>b.score-a.score).map(item=><div key={item.name} className="importance-row"><span>{item.name}</span><b>{formatValue(item.score,3)}</b><i style={{width:`${maxImportance>0?Math.max(2,Math.min(100,item.score/maxImportance*100)):0}%`}}/></div>)}</div></>:<EmptyState icon={Activity} title="Feature explanation unavailable">No feature importance or explanation payload was returned. No synthetic importance values are shown.</EmptyState>}{currentPrediction?.inputs&&<div className="prediction-inputs">{Object.entries(currentPrediction.inputs).map(([key,value])=><span key={key}><b>{key}</b> · {String(value)}</span>)}</div>}</Panel><Panel title="What-if simulation" subtitle="Runs only through the deployed FLOODCAST model pipeline"><EmptyState icon={ChartNoAxesCombined} title="Simulation endpoint unavailable">No model simulation endpoint is connected. Scenario controls remain unavailable until the actual model pipeline can return a prediction for altered inputs.</EmptyState></Panel></div>
  </>
}

function Meta({label,value}) { return <div className="prediction-meta"><span>{label}</span><b>{value||'Unavailable'}</b></div> }
