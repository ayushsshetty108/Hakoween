const DATA_BASE = (import.meta.env.VITE_WORKSPACE_DATA_BASE_URL || '/workspace-data').replace(/\/$/, '')

export const DATASETS = [
  { id: 'predictions', label: 'Prediction output', description: 'Generated FLOODCAST discharge predictions.', format: 'CSV' },
  { id: 'train', label: 'Expanded training data', description: 'Training examples and observed discharge labels.', format: 'CSV' },
  { id: 'test', label: 'Expanded test data', description: 'Rows supplied for prediction; contains no discharge target.', format: 'CSV' },
  { id: 'expanded_stations', label: 'Expanded station metadata', description: 'Station coordinates and coverage for the expanded dataset.', format: 'CSV' },
  { id: 'stations', label: 'USGS station metadata', description: 'Project station metadata from the raw acquisition.', format: 'CSV' },
  { id: 'discharge', label: 'USGS daily discharge', description: 'Historical daily mean flow observations.', format: 'CSV' },
  { id: 'weather', label: 'Open-Meteo weather history', description: 'Historical gridded weather values used by the project.', format: 'CSV' },
  { id: 'catchment', label: 'StreamStats catchment attributes', description: 'Catchment properties returned by the project acquisition.', format: 'CSV' },
  { id: 'oof_raw', label: 'Raw-discharge OOF predictions', description: 'Station-held-out validation predictions.', format: 'CSV' },
  { id: 'per_station_raw', label: 'Per-station validation metrics', description: 'Held-out error metrics for each station.', format: 'CSV' },
]

export function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"' && text[i + 1] === '"' && quoted) {
      value += '"'
      i += 1
    } else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(value)
      if (row.some(cell => cell !== '')) rows.push(row)
      row = []
      value = ''
    } else value += char
  }
  if (value !== '' || row.length) {
    row.push(value)
    if (row.some(cell => cell !== '')) rows.push(row)
  }
  const headers = (rows.shift() || []).map(header => header.trim())
  return rows.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])))
}

export async function getDataset(id, { signal } = {}) {
  const dataset = DATASETS.find(item => item.id === id)
  if (!dataset) throw new Error(`Unknown dataset: ${id}`)
  const response = await fetch(`${DATA_BASE}/${encodeURIComponent(id)}`, { signal })
  if (!response.ok) throw new Error(`${dataset.label} is unavailable (${response.status}).`)
  return parseCsv(await response.text())
}

export async function getValidationSummary({ signal } = {}) {
  const response = await fetch(`${DATA_BASE}/target_comparison`, { signal })
  if (!response.ok) throw new Error(`Validation summary is unavailable (${response.status}).`)
  return response.json()
}

export function downloadCsv(rows, filename, columns) {
  if (!rows.length) return
  const keys = columns || Object.keys(rows[0])
  const escape = value => {
    const text = value == null ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const content = [keys.map(escape).join(','), ...rows.map(row => keys.map(key => escape(row[key])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
