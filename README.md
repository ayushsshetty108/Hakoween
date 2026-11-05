# FLOODCAST 

## Project

Predict daily `discharge_cfs` at river stations excluded from training. The default model uses the expanded 24-gauge training set and predicts raw discharge; raw discharge and basin-normalized specific discharge (`Q / drainage_area_sqmi`) were compared using identical station-grouped folds.

## Author

**PREETHAM B**  
Artificial Intelligence and Machine Learning Department  
BMS Institute of Technology and Management

## Architecture

- `src/models/flood_detection.py` supports the experimental `Q/A` target transform. The selected model predicts raw `Q`.
- `src/models/ensemble.py` blends HGB, CatBoost, and LightGBM with fixed 50/35/15 weights in both wet and dry regimes.
- `src/validation/cross_validation.py` compares raw and specific-discharge targets with station-grouped folds and computes all four weighted-scoring metrics.
- `solution.py` trains the selected target mode, writes `prediction.csv`, and calls `verify_submission_guardrails()` before and after serialization.

ExtraTrees and XGBoost are not part of this pipeline.

## Install and run

From the project root in VS Code:

```bash
python -m pip install -r requirements.txt
python acquire_real_data.py
python -m src.validation.isolated_experiments
python solution.py
python validate_submission.py --test data/expanded_24_station/test.csv
python -m unittest discover -s tests -v
```

Default input, report, prediction, and artifact paths resolve relative to the
project folder. `solution.py` defaults to `data/expanded_24_station/`, which
contains 24 training gauges and the unseen test gauge. Use `--input-dir
data/raw` only to run on the original four-gauge dataset.

`acquire_real_data.py` reads station IDs and date ranges from `data/raw/train.csv`
and `data/raw/test.csv`, downloads measurements from the official USGS and
Open-Meteo APIs, and saves raw response bodies alongside cleaned tables. It
queries USGS discharge only for training station/date keys. It downloads
weather for both training and test station coordinates. Run it before using the
new acquired dataset; it overwrites only acquisition outputs under `data/raw/`
and `data/processed/`, not the model, `predictions.csv`, scoring code, or
submission validation.

`python -m src.validation.isolated_experiments` runs the specific-discharge
blend, a log-specific-discharge ablation, and a CatBoost-only
specific-discharge candidate on the original four-gauge folds. It writes
OOF predictions and a comparison report under `reports/isolated_experiments/`;
it does not refit or overwrite the production artifact or `predictions.csv`.
The existing 40/30/20/10 scoring rule is used, with local candidate-range
normalization clearly marked as non-leaderboard scoring.

To compare those candidates on the expanded 24-station data, whose weather is
now complete, run:

```bash
python -m src.validation.isolated_experiments --input-dir data/expanded_24_station --output-dir reports/expanded_24_station
```

That run uses one held-out fold per station and leaves production files untouched.

Acquisition outputs:

- `data/raw/usgs_discharge.csv` and `data/raw/usgs_station_metadata.csv`
- `data/raw/openmeteo_weather.csv`
- `data/raw/streamstats_catchment_attributes.csv`
- `data/processed/floodcast_dataset.csv`
- `data/processed/data_provenance.json` and `data/processed/acquisition_summary.json`
- Original JSON API responses under `data/raw/*_responses/`; request failures in
  `data/raw/acquisition_failures.json`

Weather uses one consistent ERA5 reanalysis model from the Open-Meteo Historical
Weather API. The four requested daily weather variables are returned directly;
`soil_moisture_0_7cm` and `soil_moisture_7_28cm` are daily means of their 24 hourly
values and remain missing if unavailable. StreamStats attributes are retained
only when the returned basin passes outlet geometry, snap, HUC where applicable,
and USGS drainage-area checks. Unsupported attributes and unverified watersheds
remain missing with a recorded reason. Current source limits mean the acquired
catchment table is not complete for all stations; see the provenance report
before running the specific-discharge model, which requires positive drainage
area for every training and test row.

Sources: [USGS Water Data API](https://api.waterdata.usgs.gov/docs/ogcapi),
[Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api),
[USGS StreamStats Web Services](https://www.usgs.gov/streamstats/web-services),
[SS-Delineate and SS-Hydro workflow](https://s3.us-east-1.amazonaws.com/streamstats.usgs.gov/StreamStatsFlowStatisticsWorkflow.pdf).
The USGS National Streamflow Statistics (NSS) service remains documented as a
separate service for regional regression estimates of flow statistics. It was
investigated but not used here because this acquisition needs observed daily
discharge and basin attributes, not regression-estimated flow statistics. See
[USGS NSS services](https://streamstats.usgs.gov/docs/nssservices/) and the
[USGS service overview](https://www.usgs.gov/streamstats/web-services).

The default command runs the station-held-out raw-vs-specific target comparison
on the expanded 24-station data, fits the selected raw-discharge ensemble on
all permitted training rows,
saves `models/floodcast_final.joblib`, writes `prediction.csv`, then checks the
serialized CSV. Use `--skip-validation` for a final fit after reviewing the
OOF reports. `--input-dir`, `--output`, `--report-dir`, and `--artifact` can
point to organizer files and separate output locations.

Raw discharge is the selected target. To compare on the original four-gauge data:

```bash
python solution.py --input-dir data/raw
```

The selected default inputs are in `data/expanded_24_station/`. `train.csv` and
`test.csv` define the project station
keys and dates. `feature_context.csv`, when present, supplies date-keyed weather
history for lag/rolling features; discharge is discarded from this context.
The held-out station has predictors only and no discharge labels.

## Scoring and validation

`cross_validation.py` computes overall RMSE on all OOF rows, extreme-event RMSE on actual flows at or above each station's 90th percentile, MAE, and R². It applies 40/30/20/10 weights after min-max normalization. Pass official all-team best/worst metric values to `compute_weighted_score()` when available. Until then, the report uses the compared OOF candidates' min/max as a local proxy, not an official leaderboard score.

The selected final configuration is the fixed HGB/CatBoost/LightGBM blend,
`hydro_plus` feature set, raw-discharge target, and expanded 24-gauge training
data. On the same station-grouped OOF comparison, raw discharge scored better
than specific discharge on all four metrics. The `median_baseline` note in
earlier model-selection materials is not the configuration wired into
`solution.py`. Final full-data fitting is separate from validation; held-out
station labels are used only for scoring, never for fitting or prediction.

Drainage area must be present, finite, strictly positive, and expressed in
square miles for both train and test. The pipeline fails clearly if this
requirement is not met; it does not infer or substitute area. Missing weather
predictors are handled by the fitted median imputers. Static catchment values
and weather inputs are listed in the model card.

## Example experiment

On the expanded 24-station training set, the fixed HGB/CatBoost/LightGBM blend
was evaluated with identical station-grouped folds for both target choices:

| Metric | Raw-discharge target | Specific-discharge target |
|---|---:|---:|
| Overall RMSE | 58,507.37 cfs | 98,465.34 cfs |
| Extreme-event RMSE | 114,017.44 cfs | 196,579.16 cfs |
| MAE | 12,542.88 cfs | 14,845.48 cfs |
| R² | 0.0141 | -1.7923 |

The 40/30/20/10 weighted rubric is unchanged. The local normalized score uses
only these two target modes, so it is not an accuracy percentage or an official
leaderboard score. The result supports the raw target for this training set but
does not guarantee transfer to arbitrary basins. The unseen test gauge has no
discharge labels, so its accuracy is unknown.

## Final submission checks

The guardrail requires exactly three columns in this order: `station_id`, `date`, `discharge_cfs`. It checks test row count, exact station/date order, finite values, and non-negative discharge. Predictions are clipped to at least `0.0` before the checks run.

The independent `validate_submission.py` additionally checks unique keys,
exactly-once station-date coverage, and accidental index columns, printing a
separate PASS/FAIL line for each check. The fitted estimator, target transformer,
feature names, target mode, model family, random seed, and blend weights are
stored in the joblib model artifact.

## File structure

```text
FLOODCAST_Hackathon_V2/
├── README.md
├── model_card.md
├── requirements.txt
├── solution.py
├── data/
│   ├── raw/
│   └── processed/
├── reports/
└── src/
    ├── data/preprocessing.py
    ├── hydrology/features.py
    ├── models/
    │   ├── baseline.py
    │   ├── ensemble.py
    │   ├── flood_detection.py
    │   └── train_models.py
    └── validation/cross_validation.py
```
