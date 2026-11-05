# FLOODCAST frontend

Run `npm ci`, then `npm run dev` from this directory. `npm run build` creates the production bundle.

The application includes `/dashboard`, `/live-map`, `/stations`, `/predictions`, `/analytics`, `/flood-alerts`, `/model-performance`, `/data-explorer`, and `/about`. Existing `/weather` and `/catchment` pages remain available. Source datasets are read-only and are not copied or edited.

The Vite-only `/workspace-data/*` routes expose an explicit allowlist of project files for local development, including the generated root-level `prediction.csv` and saved validation reports. They do not expose arbitrary files, environment variables, or secrets. These routes are not present in the production bundle. Set `VITE_WORKSPACE_DATA_BASE_URL` to a production API base that implements the same dataset IDs (`predictions`, `train`, `test`, `expanded_stations`, `stations`, `discharge`, `weather`, `catchment`, `oof_raw`, `per_station_raw`, and `target_comparison`). The prediction and validation pages show an unavailable state if their source file or endpoint is missing.

## Live river monitoring

The Monitoring page uses React Leaflet and OpenStreetMap street tiles, with Esri World Imagery satellite and Esri Topographic basemaps. It includes the four supported USGS stations, station autocomplete, full-screen map, the project's verified watershed boundaries, and bounded river reaches from USGS Network Linked Data Index (NLDI). Basin outlines are shown only when a matching project boundary is available; the rainfall circle is explicitly a selected-coordinate model estimate rather than a basin-wide surface.

In development, `src/services/liveStations.js` requests the USGS Water Data API `latest-continuous` collection for `USGS-01646500`, `USGS-02087500`, `USGS-07010000`, and `USGS-08158000`, for discharge (`00060`) and gage height (`00065`). Vite proxies the request to avoid browser CORS issues. The app shares and caches one live snapshot for 4.5 minutes and refreshes at five-minute intervals. A failed refresh leaves the last successful snapshot visible with its original observation timestamp. Historical daily means stay labeled as historical.

`src/services/openMeteo.js` requests a bounded seven-day past/seven-day forecast window for only the selected station coordinate. Responses are cached per station for two hours. Temperature, precipitation/rainfall, soil-moisture depth, snowfall and snow depth remain model estimates with units, time labels and point/grid provenance. The UI does not treat these values as basin averages. Any snowmelt description is explicitly derived from returned weather values; it is not a direct measurement.

## Backend adapter

The backend is not present in this project. `src/services/api.js` contains the reusable frontend adapter; set `VITE_API_BASE_URL` when the API is hosted on another origin.

Start the application with `npm run dev` and build it with `npm run build`. The development data endpoint resolves project files from the repository root, so run Vite from `frontend/`.

| Route | Frontend use |
| --- | --- |
| `GET /api/stations` | Station metadata/profile and existing project records |
| `GET /api/stations/live` | Latest station measurements, approval metadata, validated risk classification/threshold, rate of rise, and any alert flags |
| `GET /api/stations/{station_id}` | Station-specific metadata and available observations |
| `GET /api/stations/{station_id}/discharge` | Station discharge series adapter |
| `GET /api/stations/{station_id}/weather` | Station weather adapter |
| `GET /api/predictions` | Prediction series, grouped by station |
| `GET /api/predictions/{station_id}` | Station prediction adapter |

The live response can use `{ "stations": [...] }` and include `station_id`, `streamflow` and `gauge_height` objects with `value`, `time`, `unit`, `approval_status`, and `parameter_code`. Risk must include both a classification and its threshold source to be displayed. Prediction series should include station ID, generated time, valid time, predicted discharge, unit and model metadata when available. Calibrated uncertainty and feature explanations are displayed only when present in the model response.

The development adapter falls back to public USGS observations if the Floodcast backend is unavailable. Production requires the backend live route; the direct public feed is intentionally development-only. Alert center entries are derived from current returned data and backend alert flags. Persistent alert history, calibrated model evaluation, and what-if simulation remain unavailable until their backend/model endpoints return those outputs. No flood thresholds, model predictions, or missing measurements are synthesized.

## Data sources

- USGS Water Data API for continuous discharge and gage-height observations.
- USGS NLDI for bounded river network navigation.
- Open-Meteo forecast model for selected-coordinate environmental estimates.
- Existing project files for historical measurements, processed catchment attributes, and verified watershed boundaries.

Sources, timestamps, units and observation/prediction labels are shown where the source provides them. USGS observations can be delayed or provisional; the displayed timestamp and approval state should be checked before operational use.
