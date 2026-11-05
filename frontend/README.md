# FLOODCAST frontend

Run `npm ci`, then `npm run dev` from this directory. `npm run build` creates a production bundle and copies an explicit allowlist of public project datasets into it.

## Deploy to Render

The repository includes a Render Blueprint in `../render.yaml`. In Render, create a new Blueprint from this repository and select the `floodcast` static site. The service builds from the repository root so the allowlisted datasets outside `frontend/` are available, runs `npm ci --prefix frontend && npm --prefix frontend run build`, publishes `frontend/dist`, and rewrites application routes to `index.html` for React Router deep links.

The build requires the tracked prediction, training, test, source, and validation files listed in `frontend/scripts/build.mjs`. It bundles only those allowlisted data files under `/workspace-data/`; it does not expose model artifacts, raw API response archives, credentials, or arbitrary repository files. Data is public to site visitors and should only be bundled if it is approved for public access. The temporary public copies are removed from the working tree after the build.

The Blueprint deploys a separate Python API service and injects its host into the static site's `VITE_API_BASE_URL`. Set `CORS_ORIGINS` on the API if the frontend is hosted at a different origin. `VITE_WORKSPACE_DATA_BASE_URL` defaults to `/workspace-data` and normally needs no override for this Render setup.

To redeploy with refreshed prediction or data files, update the source files in Git and trigger a Render deploy. The API service uses the checked-in model artifact for experimental daily estimates from Open-Meteo weather forecasts; it does not accept or execute arbitrary uploaded judge files.

The application includes `/dashboard`, `/live-map`, `/stations`, `/predictions`, `/analytics`, `/flood-alerts`, `/model-performance`, `/data-explorer`, and `/about`. Existing `/weather` and `/catchment` pages remain available. Source datasets are read-only and are not copied or edited.

The Vite-only `/workspace-data/*` routes expose an explicit allowlist of project files for local development, including the generated root-level `prediction.csv` and saved validation reports. They do not expose arbitrary files, environment variables, or secrets. These routes are not present in the production bundle. Set `VITE_WORKSPACE_DATA_BASE_URL` to a production API base that implements the same dataset IDs (`predictions`, `train`, `test`, `expanded_stations`, `stations`, `discharge`, `weather`, `catchment`, `oof_raw`, `per_station_raw`, and `target_comparison`). The prediction and validation pages show an unavailable state if their source file or endpoint is missing.

## Live river monitoring

The Monitoring page uses React Leaflet and OpenStreetMap street tiles, with Esri World Imagery satellite and Esri Topographic basemaps. It includes the four supported USGS stations, station autocomplete, full-screen map, the project's verified watershed boundaries, and bounded river reaches from USGS Network Linked Data Index (NLDI). Basin outlines are shown only when a matching project boundary is available; the rainfall circle is explicitly a selected-coordinate model estimate rather than a basin-wide surface.

In development, `src/services/liveStations.js` requests the USGS Water Data API `latest-continuous` collection for `USGS-01646500`, `USGS-02087500`, `USGS-07010000`, and `USGS-08158000`, for discharge (`00060`) and gage height (`00065`). Vite proxies the request to avoid browser CORS issues. The app shares and caches one live snapshot for 4.5 minutes and refreshes at five-minute intervals. A failed refresh leaves the last successful snapshot visible with its original observation timestamp. Historical daily means stay labeled as historical.

`src/services/openMeteo.js` requests a bounded seven-day past/seven-day forecast window for only the selected station coordinate. Responses are cached per station for two hours. Temperature, precipitation/rainfall, soil-moisture depth, snowfall and snow depth remain model estimates with units, time labels and point/grid provenance. The UI does not treat these values as basin averages. Any snowmelt description is explicitly derived from returned weather values; it is not a direct measurement.

## Backend API

From the repository root, install the Python requirements and frontend dependencies once, then run `npm run dev` to start the API at `http://localhost:8000` and Vite at `http://localhost:5173`. Vite proxies `/api` requests to the local API. To run either service separately, use `python -m uvicorn backend.app:app --reload --port 8000` from the repository root or `npm run dev` from `frontend/`.

| Route | Frontend use |
| --- | --- |
| `GET /api/stations` | Station metadata/profile and existing project records |
| `GET /api/stations/live` | Latest station measurements, approval metadata, validated risk classification/threshold, rate of rise, and any alert flags |
| `GET /api/stations/{station_id}` | Station-specific metadata and available observations |
| `GET /api/stations/{station_id}/discharge` | Station discharge series adapter |
| `GET /api/stations/{station_id}/weather` | Station weather adapter |
| `GET /api/predictions` | Prediction series, grouped by station |
| `GET /api/predictions/{station_id}` | Station prediction adapter |

The live response includes `station_id`, `streamflow` and `gauge_height` objects with `value`, `time`, `unit`, `approval_status`, and `parameter_code`. Prediction series include station ID, generated time, valid time, predicted discharge, unit and model metadata. These are experimental model estimates using Open-Meteo forecast weather and are not calibrated operational forecasts or flood warnings. The project has no verified station-specific flood thresholds; risk classifications therefore remain unavailable rather than being fabricated.

The development adapter falls back to public USGS observations if the Floodcast backend is unavailable. Production requires the backend live route; the direct public feed is intentionally development-only. Alert center entries are derived from current returned data and backend alert flags. Persistent alert history, calibrated model evaluation, and what-if simulation remain unavailable until their backend/model endpoints return those outputs.

## Data sources

- USGS Water Data API for continuous discharge and gage-height observations.
- USGS NLDI for bounded river network navigation.
- Open-Meteo forecast model for selected-coordinate environmental estimates.
- Existing project files for historical measurements, processed catchment attributes, and verified watershed boundaries.

Sources, timestamps, units and observation/prediction labels are shown where the source provides them. USGS observations can be delayed or provisional; the displayed timestamp and approval state should be checked before operational use.
