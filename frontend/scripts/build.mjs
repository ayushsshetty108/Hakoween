import { existsSync, mkdirSync, readdirSync, rmdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const publicDataDir = path.join(frontendRoot, 'public', 'workspace-data')
const datasets = {
  'train.csv': 'data/expanded_24_station/train.csv',
  'test.csv': 'data/expanded_24_station/test.csv',
  'predictions.csv': 'prediction.csv',
  'expanded_stations.csv': 'data/expanded_24_station/added_station_metadata.csv',
  'stations.csv': 'data/raw/station_metadata.csv',
  'drainage.csv': 'data/raw/station_metadata.csv',
  'catchment.csv': 'data/raw/streamstats_catchment_attributes.csv',
  'discharge.csv': 'data/raw/usgs_discharge.csv',
  'weather.csv': 'data/raw/openmeteo_weather.csv',
}
const optionalEmptyDatasets = ['prism.csv', 'nlcd.csv']
const optionalReportDatasets = {
  'oof_raw.csv': {
    source: 'reports/oof_raw_discharge.csv',
    fallback: 'station_id,date,discharge_cfs,drainage_area_sqmi,pred_cfs\n',
  },
  'per_station_raw.csv': {
    source: 'reports/per_station_raw_discharge.csv',
    fallback: 'station_id,n_days,drainage_area_sqmi,overall_rmse,extreme_rmse,mae,r2,peak_mean_bias_cfs\n',
  },
  'target_comparison.json': {
    source: 'reports/target_comparison.json',
    fallback: JSON.stringify({
      split: 'Validation report unavailable in this deployment.',
      metrics: {},
      normalization_note: 'No official or local metrics are available.',
    }, null, 2),
  },
}
const createdFiles = []

function preparePublicData() {
  mkdirSync(publicDataDir, { recursive: true })
  for (const [name, relativeSource] of Object.entries(datasets)) {
    const source = path.resolve(projectRoot, relativeSource)
    if (!source.startsWith(`${projectRoot}${path.sep}`)) throw new Error(`Dataset path is outside the project: ${relativeSource}`)
    if (!existsSync(source)) throw new Error(`Required Render dataset is missing: ${relativeSource}`)
    const destination = path.join(publicDataDir, name)
    if (existsSync(destination)) throw new Error(`Refusing to overwrite an existing public dataset: ${destination}`)
    copyFileSync(source, destination)
    createdFiles.push(destination)
  }
  for (const [name, { source: relativeSource, fallback }] of Object.entries(optionalReportDatasets)) {
    const destination = path.join(publicDataDir, name)
    if (existsSync(destination)) throw new Error(`Refusing to overwrite an existing public dataset: ${destination}`)
    const source = path.resolve(projectRoot, relativeSource)
    if (existsSync(source)) copyFileSync(source, destination)
    else writeFileSync(destination, fallback, 'utf8')
    createdFiles.push(destination)
  }
  for (const name of optionalEmptyDatasets) {
    const destination = path.join(publicDataDir, name)
    if (existsSync(destination)) throw new Error(`Refusing to overwrite an existing public dataset: ${destination}`)
    writeFileSync(destination, 'station_id\n', 'utf8')
    createdFiles.push(destination)
  }
}

function cleanPublicData() {
  for (const file of createdFiles) if (existsSync(file)) unlinkSync(file)
  if (existsSync(publicDataDir) && readdirSync(publicDataDir).length === 0) rmdirSync(publicDataDir)
}

process.chdir(frontendRoot)
try {
  preparePublicData()
  await build({ configFile: path.join(frontendRoot, 'vite.config.js'), root: frontendRoot })
} finally {
  cleanPublicData()
}
