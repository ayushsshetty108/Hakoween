# FLOODCAST V2 real-data acquisition report

## Scope and retrieval

- Final integrated dataset refresh UTC: `2026-11-05T02:03:32.382343+00:00`; source-specific retrieval timestamps are recorded in `data/processed/data_provenance.json`.
- Project inputs inspected: `data/raw/train.csv`, `data/raw/test.csv`, and `data/raw/station_metadata.csv`.
- Training keys: 13,147 rows across 4 stations, 2010-01-01 through 2018-12-31.
- Test keys: 365 rows across 1 held-out station(s), 2019-01-01 through 2019-12-31.
- USGS discharge was requested only for training station/date keys. No held-out test-station discharge was requested or joined.

## Official sources and records

| Source | Request scope | Records saved | Result |
|---|---|---:|---|
| USGS Water Data OGC API, daily values (`00060`, statistic `00003`) | Four training stations, 2010-01-01 to 2018-12-31, cfs | 13,147 | Complete match to `train.csv` keys; 0 missing values, 0 duplicate keys. |
| USGS monitoring locations | All five stations | 5 | Names, coordinates, state, county, HUC and station drainage area captured where supplied. |
| Open-Meteo Historical Archive (ERA5, UTC) | All five actual USGS coordinates, 2010-01-01 to 2019-12-31 | 18,260 | 3,652 daily rows per station; all six requested weather features complete, including both soil layers. |
| USGS SS-Delineate + SS-Hydro | All five actual USGS coordinates | 5 station results | 2 watersheds verified; the rest kept missing with a reason. |

Official raw response bodies are saved under each `data/raw/*_responses/` directory (24 response JSON files). The source endpoints and request/response audit are recorded in `data/processed/data_provenance.json`. The run recorded 1 transient failed request attempt (SS-Hydro for `08158000`), recovered on retry, and 0 terminal failures. The failed attempt and its retry response are listed in the provenance file.

## USGS station metadata

| Station | USGS station name | Latitude, longitude | State | HUC |
|---|---|---|---|---|
| 01646500 | POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA | 38.949778, -77.127639 | Maryland | 020700081005 |
| 02087500 | NEUSE RIVER NEAR CLAYTON, NC | 35.647222, -78.405278 | North Carolina | 03020201 |
| 07010000 | Mississippi River at St. Louis, MO | 38.629000, -90.179778 | Missouri | 071401010403 |
| 08158000 | Colorado Rv at Austin, TX | 30.246139, -97.680056 | Texas | 120902050306 |
| 11447650 | SACRAMENTO R A FREEPORT CA | 38.455664, -121.501617 | California | 180201630701 |

The live USGS coordinates match the existing project metadata within 1e-5 degrees at all five stations. The existing project metadata file has no HUC field, so HUC values are reported from the live USGS metadata without claiming a comparison to the input file.

## Catchment results

| Station | Drainage area (sq mi) | Mean basin elevation (m) | Slope (%) | Forest (%) | Impervious (%) | Delineation |
|---|---:|---:|---:|---:|---:|---|
| 01646500 | — | — | — | — | — | Unverified |
| 02087500 | 1153.0 | 423.74 | 6.888 | — | 6.24 | Verified |
| 07010000 | — | — | — | — | — | Unverified |
| 08158000 | — | — | — | — | — | Unverified |
| 11447650 | 27234.0 | — | — | — | 1.14 | Verified |

Missing catchment values by attribute: `{"drainage_area_sqmi": 3, "mean_basin_elevation_m": 4, "slope_pct": 4, "forest_cover_pct": 5, "impervious_surface_pct": 3}`. The three unverified outlets returned SS-Delineate “not snappable” warnings and/or failed HUC/drainage-area verification. For station `11447650`, the service returned a non-HUC regional unit; point-in-basin geometry and drainage area matching USGS metadata were used for verification. Point-extracted elevation and slope were rejected as outlet measurements rather than basin summaries. Forest cover was unavailable from the current service for all five stations.

## Integrated dataset and checks

- `data/processed/floodcast_dataset.csv`: 18,260 weather station-days. It contains 13,147 observed training discharge labels; the other rows intentionally have no discharge label (outside the supplied training keys or held-out station).
- Weather missing values: `{"station_id": 0, "date": 0, "precipitation_mm": 0, "temp_max_c": 0, "temp_min_c": 0, "temp_mean_c": 0, "soil_moisture_0_7cm": 0, "soil_moisture_7_28cm": 0}`.
- Duplicate weather keys: 0; duplicate discharge keys: 0.
- All 24 source response JSON files parsed; no invalid raw JSON detected.
- Train/test station mapping and test-label exclusion checks passed.
- No synthetic measurements, fabricated missing values, or substitute data were added.

## Readiness and limits

The USGS discharge and Open-Meteo weather tables have complete coverage for the supplied keys and requested continuous date ranges, so the real observed discharge/weather portion is available for supervised experiments. The **full requested catchment feature set is not ready for the specific-discharge model**: only one of the four training watersheds verified, drainage area is missing for three of the five stations, and the existing model requires positive drainage area for every train/test row. The dataset therefore preserves those missing attributes and the acquisition summary reports `training_ready: false`. Do not run the specific-discharge experiment on this dataset until the failed basin mappings are resolved with official verified attributes.

The National Streamflow Statistics service was reviewed but not queried. It provides regression-based flow statistics; this request required measured daily discharge and catchment characteristics. Service references: [USGS NSS services](https://streamstats.usgs.gov/docs/nssservices/), [USGS StreamStats web services](https://www.usgs.gov/streamstats/web-services).

## Files created by acquisition

- `acquire_real_data.py`
- `data/raw/usgs_discharge.csv`
- `data/raw/usgs_station_metadata.csv`
- `data/raw/openmeteo_weather.csv`
- `data/raw/streamstats_catchment_attributes.csv`
- `data/raw/acquisition_failures.json`
- Raw JSON bodies under `data/raw/usgs_responses/`, `data/raw/openmeteo_responses/`, and `data/raw/streamstats_responses/`
- `data/processed/floodcast_dataset.csv`
- `data/processed/data_provenance.json`
- `data/processed/acquisition_summary.json`
- `reports/data_acquisition_report.md`

The existing final model, scoring weights, submission validator, and `predictions.csv` were not changed. The predictions file SHA-256 after acquisition is `79b58a0753bd721d34f6861a5870f1d725dab673bb889f251557f9fe57876314`.
