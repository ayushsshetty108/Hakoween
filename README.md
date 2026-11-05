# FLOODCAST

FLOODCAST estimates daily river discharge (`discharge_cfs`) for station-date rows. The Python pipeline builds leakage-safe weather and hydrology features, validates models using station-held-out folds, fits a fixed HGB/CatBoost/LightGBM blend, and writes a submission CSV. The repository also contains a React dashboard for monitoring, forecasts, catchments, and model performance.

## Project architecture

### Python modeling and data pipeline

1. **Acquire and prepare data.** `acquire_real_data.py` reads station/date keys and station metadata from `data/raw/`, retrieves training discharge from the USGS Water Data API, weather history from Open-Meteo, and catchment attributes from USGS StreamStats. It stores cleaned tables and raw responses separately and writes provenance and acquisition summaries. Test-station discharge is not requested.
2. **Load and validate inputs.** `src/data/preprocessing.py` validates and loads the train/test inputs.
3. **Build features.** `src/hydrology/features.py` creates calendar, weather lag/rolling, precipitation-history, temperature, and drainage-area proxy features. It excludes discharge from feature generation and can use `feature_context.csv` for historical predictor context. The production pipeline uses the `hydro_plus` feature set.
4. **Train and predict.** `src/models/train_models.py` builds the estimators; `src/models/ensemble.py` fits HGB, CatBoost, and LightGBM and blends their predictions with fixed 50/35/15 weights. The production target is raw discharge. `src/models/flood_detection.py` provides the optional specific-discharge (`Q/A`) transform for comparison experiments.
5. **Validate and report.** `src/validation/cross_validation.py` performs station-grouped target comparisons and calculates the scoring metrics. `src/validation/isolated_experiments.py` runs separate candidate experiments without overwriting production outputs.
6. **Write a submission.** `solution.py` orchestrates features, optional validation, final fitting, artifact serialization, and CSV guardrails. It writes `prediction.csv` and, by default, `models/floodcast_final.joblib`. `validate_submission.py` independently checks the saved CSV against the selected `test.csv`.

The production model is the fixed HGB/CatBoost/LightGBM blend with the `hydro_plus` features and raw-discharge target. The wet and dry regimes currently use the same weights. ExtraTrees and XGBoost are not part of this pipeline. See [`model_card.md`](model_card.md) for model details and feature inputs.

### Frontend dashboard

`frontend/` is a Vite/React application with Overview, Monitoring, Predictions, Weather, Catchment, and Performance pages. Components and page routes live in `frontend/src/`; API and data adapters live in `frontend/src/services/`. The repository does **not** include a backend. The frontend README documents its expected API routes, local development data routes, and live USGS/Open-Meteo integrations: [`frontend/README.md`](frontend/README.md).

## Install and run the Python pipeline

Run commands from the repository root:

```bash
python -m pip install -r requirements.txt
python solution.py
python validate_submission.py --test data/expanded_24_station/test.csv
python -m unittest discover -s tests -v
```

`solution.py` defaults to `data/expanded_24_station/`, uses raw discharge, runs station-held-out validation, writes OOF reports under `reports/`, saves the model artifact, and creates `prediction.csv`. Use `--skip-validation` to fit without rerunning the OOF comparison. The `--input-dir`, `--output`, `--report-dir`, `--artifact`, and `--target-mode` options can select other inputs and output locations. Relative paths resolve from the project directory.

To use the original four-station dataset instead:

```bash
python solution.py --input-dir data/raw
```

To acquire or refresh the original dataset's source data, run:

```bash
python acquire_real_data.py
```

Acquisition requires the source input files under `data/raw/`. It writes acquisition tables/responses under `data/raw/` and integrated data, provenance, and summary files under `data/processed/`; review `data/processed/data_provenance.json` and the acquisition report before using the results. Acquisition may exit with a nonzero status if source coverage or catchment verification is incomplete.

Run the isolated candidate experiments separately:

```bash
python -m src.validation.isolated_experiments
python -m src.validation.isolated_experiments --input-dir data/expanded_24_station --output-dir reports/expanded_24_station
```

These runs write experiment reports and OOF predictions to their output directory and do not refit the production artifact or replace `prediction.csv`.

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Create a production bundle with `npm run build`. For a hosted backend on another origin, configure `VITE_API_BASE_URL` as described in `frontend/README.md`.

## Data and validation notes

- The default model input is `data/expanded_24_station/`; `train.csv` and `test.csv` define the requested station-date rows. `feature_context.csv`, when present, provides date-keyed historical predictors; discharge is discarded from that context. The held-out test station has no discharge labels.
- Drainage area must be finite and strictly positive in square miles for both train and test rows. The pipeline does not infer a replacement area. Missing weather predictors are handled by the fitted imputers.
- `solution.py` checks the submission schema, row count, station/date order, finite predictions, and non-negative discharge before and after writing the CSV. `validate_submission.py` additionally checks key uniqueness, exactly-once station-date coverage, and accidental index columns.
- The default raw-discharge target was selected over specific discharge in the station-grouped comparison on the expanded training data. Those validation results do not establish accuracy on the unseen test gauge.
- Data sources and acquisition limitations: [USGS Water Data API](https://api.waterdata.usgs.gov/docs/ogcapi), [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), and [USGS StreamStats Web Services](https://www.usgs.gov/streamstats/web-services). Catchment attributes are retained only when watershed verification checks pass; consult the provenance report for station-level coverage.

## Repository structure

```text
Hakoween/
├── README.md
├── model_card.md
├── requirements.txt
├── acquire_real_data.py
├── solution.py
├── validate_submission.py
├── prediction.csv                 # Example/current submission output
├── data/
│   ├── raw/                       # Original train/test keys, station metadata,
│   │                              # acquired source tables and raw API responses
│   ├── expanded_24_station/       # Expanded training/test inputs and context
│   └── processed/                 # Integrated dataset and acquisition reports
├── reports/
│   ├── data_acquisition_report.md
│   ├── expanded_24_station/
│   └── isolated_experiments/
├── models/                        # Generated model artifact (not checked in)
├── src/
│   ├── data/
│   │   ├── preprocessing.py
│   │   ├── expand_station_dataset.py
│   │   ├── fetch_missing_weather.py
│   │   └── finalize_expanded_from_cache.py
│   ├── hydrology/features.py
│   ├── models/
│   │   ├── baseline.py
│   │   ├── ensemble.py
│   │   ├── flood_detection.py
│   │   └── train_models.py
│   └── validation/
│       ├── cross_validation.py
│       └── isolated_experiments.py
├── tests/
│   └── test_final_pipeline.py
└── frontend/
    ├── package.json
    ├── index.html
    └── src/
        ├── App.jsx
        ├── components/
        ├── hooks/
        ├── pages/
        └── services/
```

## Author

**PREETHAM B**  
Artificial Intelligence and Machine Learning Department  
BMS Institute of Technology and Management
