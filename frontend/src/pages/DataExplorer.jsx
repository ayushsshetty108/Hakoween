import { useMemo, useState } from 'react'
import { Database, Table2 } from 'lucide-react'
import { EmptyState, ErrorState, Loading, PageHeader, Panel, Select, StatusChip } from '../components.jsx'
import WorkspaceTable from '../components/WorkspaceTable.jsx'
import { useData } from '../hooks/useData.js'
import { DATASETS, getDataset } from '../services/workspaceData.js'

export default function DataExplorer() {
  const [dataset, setDataset] = useState('predictions')
  const [selectedColumns, setSelectedColumns] = useState(null)
  const { data, error, loading } = useData(() => getDataset(dataset), dataset)
  const headers = useMemo(() => data?.length ? Object.keys(data[0]) : [], [data])
  const chosen = selectedColumns || headers.slice(0, 9)
  const columns = useMemo(() => headers.filter(key => chosen.includes(key)).map(key => ({
    key, label: key, render: value => value === '' || value == null ? '—' : value,
  })), [headers, chosen])
  const stats = useMemo(() => headers.map(key => {
    const values = (data || []).map(row => row[key])
    const present = values.filter(value => value !== '' && value != null)
    const numeric = present.length > 0 && present.every(value => Number.isFinite(Number(value)))
    return { key, type: present.length ? (numeric ? 'Numeric' : 'Text') : 'Empty', missing: values.length - present.length }
  }), [headers, data])
  const current = DATASETS.find(item => item.id === dataset)

  function toggleColumn(key) {
    setSelectedColumns(current => {
      const base = current || headers.slice(0, 9)
      const next = base.includes(key) ? base.filter(item => item !== key) : [...base, key]
      return next.length ? next : [key]
    })
  }
  if (loading) return <Loading/>
  return <>
    <PageHeader eyebrow="PROJECT DATA" title="Data explorer" subtitle="Inspect read-only project files and their field coverage. Secret and environment files are never exposed." actions={<StatusChip tone="blue">LOCAL PROJECT DATA</StatusChip>}/>
    <div className="workspace-dataset-select"><Select value={dataset} onChange={value => { setDataset(value); setSelectedColumns(null) }} options={DATASETS.map(item => ({ value: item.id, label: item.label }))} label="Choose dataset"/>{current && <span>{current.description}</span>}</div>
    {error ? <EmptyState icon={Database} title={`${current?.label || 'Dataset'} unavailable`}>{error.message} This read-only dataset endpoint is available in the Vite development server; production deployments need a matching backend route.</EmptyState> : <>
      <div className="workspace-kpis">
        <Metric label="Rows" value={(data || []).length.toLocaleString()} note={current?.label}/>
        <Metric label="Columns" value={headers.length} note="Parsed CSV fields"/>
        <Metric label="Missing cells" value={stats.reduce((sum, row) => sum + row.missing, 0).toLocaleString()} note="Blank cells in this file"/>
        <Metric label="Format" value={current?.format || 'CSV'} note="Read-only source"/>
      </div>
      <Panel title="Column selector" subtitle="Toggle fields shown in the table">
        <div className="dataset-columns">{headers.map(key => <label key={key}><input type="checkbox" checked={chosen.includes(key)} onChange={() => toggleColumn(key)}/>{key}</label>)}</div>
      </Panel>
      <Panel title="Data preview" subtitle={current?.description}>
        {data?.length && columns.length ? <WorkspaceTable rows={data} columns={columns} filename={`floodcast-${dataset}.csv`} rowKey="_row_number"/> : <EmptyState icon={Table2}>This dataset contains no rows or fields.</EmptyState>}
      </Panel>
      <Panel title="Field quality" subtitle="Inferred types and missing-value counts from the selected file">
        <div className="workspace-field-grid">{stats.map(item => <div key={item.key}><b>{item.key}</b><span>{item.type}</span><small>{item.missing.toLocaleString()} missing / {(data || []).length.toLocaleString()} rows</small></div>)}</div>
      </Panel>
    </>}
  </>
}

function Metric({ label, value, note }) { return <div className="workspace-metric"><span>{label}</span><b>{value}</b><small>{note}</small></div> }
