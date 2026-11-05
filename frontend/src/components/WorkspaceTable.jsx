import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { downloadCsv } from '../services/workspaceData.js'

export default function WorkspaceTable({ rows, columns, filename = 'floodcast-data.csv', pageSize = 12, rowKey = 'id' }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: '', direction: 1 })
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const result = rows.filter(row => !term || columns.some(column => String(row[column.key] ?? '').toLowerCase().includes(term)))
    if (sort.key) result.sort((a, b) => String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true }) * sort.direction)
    return result
  }, [rows, columns, query, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize)

  function toggleSort(key) {
    setPage(0)
    setSort(current => ({ key, direction: current.key === key ? -current.direction : 1 }))
  }

  return <div className="workspace-table-wrap">
    <div className="workspace-table-tools">
      <label className="workspace-search"><Search size={15}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Search records" aria-label="Search table records"/></label>
      <button className="workspace-export" type="button" onClick={() => downloadCsv(filtered, filename, columns.map(column => column.key))} disabled={!filtered.length}><Download size={15}/>Export CSV</button>
      <span className="workspace-count">{filtered.length.toLocaleString()} records</span>
    </div>
    <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{columns.map(column => <th key={column.key}><button type="button" onClick={() => toggleSort(column.key)}>{column.label}{sort.key === column.key ? (sort.direction > 0 ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead>
      <tbody>{visible.map((row, index) => <tr key={row[rowKey] ?? `${page}-${index}`}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row[column.key], row) : (row[column.key] ?? '—')}</td>)}</tr>)}
      {!visible.length && <tr><td className="workspace-empty-cell" colSpan={columns.length}>No records match the current search.</td></tr>}</tbody>
    </table></div>
    <div className="workspace-table-pagination"><span>Page {Math.min(page + 1, pages)} of {pages}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous</button><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(current => Math.min(pages - 1, current + 1))}>Next</button></div></div>
  </div>
}
