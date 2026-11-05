import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Development-only, read-only access to existing project datasets. Nothing is copied into frontend/.
function workspaceData() {
  // This frontend can live beside the Python project (the current workspace
  // layout) or inside it. Resolve the actual data root instead of assuming
  // that the parent of the frontend always contains `data/`.
  const parent = path.resolve(process.cwd(), '..')
  const nestedProject = path.join(parent, 'Hakoween')
  const project = fs.existsSync(path.join(parent, 'data')) ? parent : nestedProject
  const files = {
    train: 'data/expanded_24_station/train.csv',
    test: 'data/expanded_24_station/test.csv',
    predictions: 'prediction.csv',
    expanded_stations: 'data/expanded_24_station/added_station_metadata.csv',
    oof_raw: 'reports/oof_raw_discharge.csv',
    per_station_raw: 'reports/per_station_raw_discharge.csv',
    target_comparison: 'reports/target_comparison.json',
    catchment: 'data/raw/streamstats_catchment_attributes.csv',
    discharge: 'data/raw/usgs_discharge.csv',
    weather: 'data/raw/openmeteo_weather.csv',
    stations: 'data/raw/station_metadata.csv',
    drainage: 'data/raw/station_metadata.csv',
    // These optional enrichments are not included in every project checkout.
    prism: 'data/raw/prism_ppt_1991_2020_zonal_summary.csv',
    nlcd: 'data/raw/annual_nlcd_2024_zonal_summary.csv',
  }
  return {
    name: 'read-only-workspace-data',
    configureServer(server) {
      server.middlewares.use('/workspace-data', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end('Read-only dataset access'); return }
        const parts = decodeURIComponent(req.url || '').split('/').filter(Boolean)
        const dataset = (parts[0] || '').replace(/\.(csv|json)$/i, '')
        const fileKey = files[dataset] ? dataset : parts[0]
        let relative = files[fileKey]
        if (parts[0] === 'boundary' && /^\d{8}$/.test(parts[1] || '')) relative = `data/raw/usgs_nldi_validated_basin_${parts[1]}.geojson`
        const allowedParts = parts[0] === 'boundary' ? 2 : 1
        if (!relative || parts.length > allowedParts) return next()
        if (allowedParts === 2 && parts.length !== 2) return next()
        const file = path.resolve(project, relative)
        if (!file.startsWith(`${project}${path.sep}`)) { res.statusCode = 404; res.end('Dataset unavailable'); return }
        if (!fs.existsSync(file)) {
          // Missing optional files are represented as an empty CSV so one
          // unavailable enrichment cannot prevent the rest of the dashboard.
          if (['prism', 'nlcd'].includes(fileKey)) {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.end('station_id\n')
            return
          }
          res.statusCode = 404; res.end('Dataset unavailable'); return
        }
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', parts[0] === 'boundary' ? 'application/geo+json' : relative.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), workspaceData()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      // Development-only public USGS proxy; production should use the Floodcast API.
      '/usgs-api': { target: 'https://api.waterdata.usgs.gov', changeOrigin: true, rewrite: path => path.replace(/^\/usgs-api/, '/ogcapi/v1') },
      // Bounded NLDI flowline queries for the optional river network overlay.
      '/usgs-nldi': { target: 'https://api.waterdata.usgs.gov', changeOrigin: true, rewrite: path => path.replace(/^\/usgs-nldi/, '/nldi') },
    },
  },
})
