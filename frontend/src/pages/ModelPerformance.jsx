import { useMemo } from 'react'
import { BrainCircuit, Gauge, Target } from 'lucide-react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Bar, BarChart } from 'recharts'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, StatusChip, formatValue } from '../components.jsx'
import WorkspaceTable from '../components/WorkspaceTable.jsx'
import { useData } from '../hooks/useData.js'
import { getDataset, getValidationSummary } from '../services/workspaceData.js'

export default function ModelPerformance() {
  const { data: loaded, error, loading } = useData(() => Promise.all([
    getDataset('oof_raw'), getDataset('per_station_raw'), getValidationSummary(),
  ]), 'model-performance-data')
  const oof = loaded?.[0] || []
  const stationMetrics = loaded?.[1] || []
  const validation = loaded?.[2]
  const metrics = useMemo(() => score(oof), [oof])
  const scatter = useMemo(() => {
    const stride = Math.max(1, Math.ceil(oof.length / 900))
    return oof.filter((row, index) => index % stride === 0).map(row => ({
      actual: Number(row.discharge_cfs), predicted: Number(row.pred_cfs), station_id: row.station_id, date: row.date,
    })).filter(row => Number.isFinite(row.actual) && Number.isFinite(row.predicted))
  }, [oof])
  const columns = [
    { key: 'station_id', label: 'Held-out station' }, { key: 'n_days', label: 'Rows', render: value => formatValue(value) },
    { key: 'overall_rmse', label: 'Overall RMSE (cfs)', render: value => formatValue(value, 2) },
    { key: 'extreme_rmse', label: 'Extreme RMSE (cfs)', render: value => formatValue(value, 2) },
    { key: 'mae', label: 'MAE (cfs)', render: value => formatValue(value, 2) },
    { key: 'r2', label: 'R²', render: value => formatValue(value, 3) },
    { key: 'peak_mean_bias_cfs', label: 'Peak-flow bias (cfs)', render: value => formatValue(value, 2) },
  ]
  if (loading) return <Loading/>
  if (error) return <><PageHeader eyebrow="MODEL EVALUATION" title="Model performance" subtitle="Held-out validation results are loaded from project reports."/><EmptyState icon={BrainCircuit} title="Validation reports are unavailable">{error.message}</EmptyState></>
  const topStations = stationMetrics.slice().sort((a, b) => Number(b.overall_rmse) - Number(a.overall_rmse)).slice(0, 12).map(row => ({ station: row.station_id, rmse: Number(row.overall_rmse) })).filter(row => Number.isFinite(row.rmse))
  return <>
    <PageHeader eyebrow="MODEL EVALUATION" title="Model performance" subtitle="Metrics are calculated from the saved raw-discharge out-of-fold predictions. The leaderboard's normalization ranges are not available here." actions={<StatusChip tone="blue">STATION-HELD-OUT OOF</StatusChip>}/>
    <div className="workspace-kpis">
      <Metric icon={Gauge} label="Overall RMSE" value={metrics.overall_rmse} unit="cfs" note="All out-of-fold rows"/>
      <Metric icon={Target} label="Extreme-event RMSE" value={metrics.extreme_rmse} unit="cfs" note="Top decile within each station"/>
      <Metric icon={BrainCircuit} label="Mean absolute error" value={metrics.mae} unit="cfs" note="All out-of-fold rows"/>
      <Metric icon={BrainCircuit} label="R² score" value={metrics.r2} note="All out-of-fold rows"/>
    </div>
    <div className="workspace-two-col">
      <Panel title="Actual vs predicted discharge" subtitle="Sampled station-held-out OOF rows · cfs">
        {scatter.length ? <ResponsiveContainer width="100%" height={285}><ScatterChart><CartesianGrid stroke="#33515a" strokeDasharray="3 5"/><XAxis type="number" dataKey="actual" name="Actual" unit=" cfs" width={65}/><YAxis type="number" dataKey="predicted" name="Predicted" unit=" cfs" width={65}/><Tooltip cursor={{ strokeDasharray: '3 3' }}/><Scatter data={scatter} fill="#64d8d1" fillOpacity={.5}/><ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxValue(scatter, 'actual'), y: maxValue(scatter, 'actual') }]} stroke="#f0bd73" strokeDasharray="5 5"/></ScatterChart></ResponsiveContainer> : <EmptyState>No valid OOF pairs are present.</EmptyState>}
      </Panel>
      <Panel title="Station-wise RMSE" subtitle="Largest held-out errors among available station reports">
        {topStations.length ? <ResponsiveContainer width="100%" height={285}><BarChart data={topStations} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid stroke="#33515a" strokeDasharray="3 5" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="station" width={76}/><Tooltip formatter={value => [`${formatValue(value, 2)} cfs`, 'RMSE']}/><Bar dataKey="rmse" fill="#edb76b" radius={[0, 4, 4, 0]}/></BarChart></ResponsiveContainer> : <EmptyState>No per-station error report is available.</EmptyState>}
      </Panel>
    </div>
    <Panel title="Station error report" subtitle="Per-station held-out performance and peak-flow bias">
      <WorkspaceTable rows={stationMetrics} columns={columns} filename="floodcast-station-performance.csv" rowKey="station_id"/>
    </Panel>
    <Panel title="Validation design" subtitle="Leave-One-Station-Out (LOSO) evaluation">
      <div className="workspace-detail-list">
        <Detail label="Split strategy" value={validation?.split || 'Station-grouped out-of-fold predictions'} />
        <Detail label="Leakage control" value="Each reported validation station is held out from that fold's model fit." />
        <Detail label="Extreme-event metric" value="Per-station observed discharge at or above that station's 90th percentile." />
        <Detail label="Competition score" value="Not calculated; official all-team min/max normalization values are not provided." />
        <Detail label="Model target" value="Raw discharge in cubic feet per second." />
      </div>
      <div className="workspace-notice"><BrainCircuit size={16}/><span>Saved OOF predictions are from the project's station-grouped comparison. Any weighted score based on local candidate min/max ranges is intentionally omitted.</span></div>
    </Panel>
  </>
}

function score(rows) {
  const pairs = rows.map(row => ({ station: row.station_id, actual: Number(row.discharge_cfs), predicted: Number(row.pred_cfs) }))
    .filter(row => Number.isFinite(row.actual) && Number.isFinite(row.predicted))
  if (!pairs.length) return { overall_rmse: null, extreme_rmse: null, mae: null, r2: null }
  const errors = pairs.map(row => row.predicted - row.actual)
  const overall = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length)
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length
  const mean = pairs.reduce((sum, row) => sum + row.actual, 0) / pairs.length
  const total = pairs.reduce((sum, row) => sum + (row.actual - mean) ** 2, 0)
  const residual = errors.reduce((sum, error) => sum + error ** 2, 0)
  const r2 = total ? 1 - residual / total : 0
  const groups = new Map()
  pairs.forEach(row => {
    if (!groups.has(row.station)) groups.set(row.station, [])
    groups.get(row.station).push(row.actual)
  })
  const q90 = new Map([...groups].map(([id, values]) => [id, quantile(values, .9)]))
  const peaks = pairs.filter(row => row.actual >= q90.get(row.station))
  const extreme = Math.sqrt(peaks.reduce((sum, row) => sum + (row.predicted - row.actual) ** 2, 0) / peaks.length)
  return { overall_rmse: overall, extreme_rmse: extreme, mae, r2 }
}
function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower])
}
function maxValue(rows, key) { return rows.reduce((max, row) => Math.max(max, row[key]), 0) }
function Metric({ icon: Icon, label, value, unit, note }) {
  return <div className="workspace-metric"><span><Icon size={15}/>{label}</span><b>{value == null ? '—' : formatValue(value, 2)}{unit && value != null && <small> {unit}</small>}</b><small>{note}</small></div>
}
function Detail({ label, value }) { return <div className="workspace-detail-row"><span>{label}</span><b>{value}</b></div> }
