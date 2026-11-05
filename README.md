# FLOODCAST V2

## Project

Predict daily `discharge_cfs` at river stations excluded from training. V2 compares direct discharge prediction with basin-normalized specific discharge (`Q / drainage_area_sqmi`) using the same station-held-out folds.

## Author

**PREETHAM B**  
Artificial Intelligence and Machine Learning Department  
BMS Institute of Technology and Management

## Architecture

- `src/models/flood_detection.py` transforms `Q` to `Q/A` and back. `use_log=False`; log transforms are rejected.
- `src/models/ensemble.py` blends HGB, CatBoost, and LightGBM with fixed 50/35/15 weights in both wet and dry regimes.
- `src/validation/cross_validation.py` compares raw and specific-discharge targets with station-grouped folds and computes all four weighted-scoring metrics.
- `solution.py` trains the selected target mode, writes `predictions.csv`, and calls `verify_submission_guardrails()` before and after serialization.

ExtraTrees and XGBoost are not part of this pipeline.

## Install and run

From the project root in VS Code:

```bash
python -m pip install -r requirements.txt
python acquire_real_data.py
python -m src.validation.isolated_experiments
python solution.py
python validate_submission.py
python -m unittest discover -s tests -v
```

Default input, report, prediction, and artifact paths resolve relative to the
project folder, so launching `solution.py` from another working directory will
still find `data/raw/train.csv` and `data/raw/test.csv`.

`acquire_real_data.py` reads station IDs and date ranges from `data/raw/train.csv`
and `data/raw/test.csv`, downloads measurements from the official USGS and
Open-Meteo APIs, and saves raw response bodies alongside cleaned tables. It
queries USGS discharge only for training station/date keys. It downloads
weather for both training and test station coordinates. Run it before using the
new acquired dataset; it overwrites only acquisition outputs under `data/raw/`
and `data/processed/`, not the model, `predictions.csv`, scoring code, or
submission validation.

`python -m src.validation.isolated_experiments` runs the current specific-
discharge blend, a log-specific-discharge ablation, and a CatBoost-only
specific-discharge candidate on the same four station-held-out folds. It writes
OOF predictions and a comparison report under `reports/isolated_experiments/`;
it does not refit or overwrite the production artifact or `predictions.csv`.
The existing 40/30/20/10 scoring rule is used, with local candidate-range
normalization clearly marked as non-leaderboard scoring.

To compare the same candidates on the expanded 24-station data, whose weather
is now complete, run:

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

The default command runs the station-held-out raw-vs-specific target comparison,
fits the final specific-discharge ensemble on all permitted training rows,
saves `models/floodcast_final.joblib`, writes `predictions.csv`, then checks the
serialized CSV. Use `--skip-validation` for a final fit after reviewing the
OOF reports. `--input-dir`, `--output`, `--report-dir`, and `--artifact` can
point to organizer files and separate output locations.

By default the final model uses specific discharge. To generate the raw-discharge comparison submission instead:

```bash
python solution.py --target-mode raw_discharge
```

Inputs are in `data/raw/`. `train.csv` and `test.csv` define the project station
keys and dates. `feature_context.csv`, when present, supplies date-keyed weather
history for lag/rolling features; discharge is discarded from this context.
The held-out station has predictors only and no discharge labels.

## Scoring and validation

`cross_validation.py` computes overall RMSE on all OOF rows, extreme-event RMSE on actual flows at or above each station's 90th percentile, MAE, and R². It applies 40/30/20/10 weights after min-max normalization. Pass official all-team best/worst metric values to `compute_weighted_score()` when available. Until then, the report uses the compared OOF candidates' min/max as a local proxy, not an official leaderboard score.

The selected final configuration is the fixed HGB/CatBoost/LightGBM blend,
`hydro_plus` feature set, and raw specific-discharge target (`Q/A`, `use_log=False`).
This follows the current executable configuration and the available V2 comparison
report. The `median_baseline` note in earlier model-selection materials is not
the configuration currently wired into `solution.py`; no unsupported claim is
made that it supersedes this pipeline. Final full-data fitting is separate from
the station-held-out comparison. Validation labels for a held-out station are
used only for scoring its fold, never to fit models or form predictions.

Drainage area must be present, finite, strictly positive, and expressed in
square miles for both train and test. The pipeline fails clearly if this
requirement is not met; it does not infer or substitute area. Missing weather
predictors are handled by the fitted median imputers. Static catchment values
and weather inputs are listed in the model card.

## Example experiment

On the bundled four-station training example, the fixed HGB/CatBoost/LightGBM blend improved all four pooled OOF metrics when trained on specific discharge:

| Metric | Raw-discharge target | Specific-discharge target |
|---|---:|---:|
| Overall RMSE | 146,080.88 cfs | 128,111.24 cfs |
| Extreme-event RMSE | 280,308.96 cfs | 234,625.03 cfs |
| MAE | 73,969.72 cfs | 61,701.65 cfs |
| R² | -0.2631 | 0.0286 |

Specific discharge reduced RMSE on 3 of 4 held-out stations. It worsened RMSE at station 08158000 (29,077.79 to 40,416.52 cfs), so the result does not guarantee transfer to every basin. The local 0 vs 100 normalized scores use only these two target modes and are not accuracy percentages or official leaderboard scores. The separate example test gauge has no discharge labels, so its score is unknown.

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
