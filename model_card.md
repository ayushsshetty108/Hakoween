# FLOODCAST V2 Model Card

## Author

**PREETHAM B**  
Artificial Intelligence and Machine Learning Department  
BMS Institute of Technology and Management

## Intended use

Offline prediction of daily river discharge at stations not used for model fitting. This prototype is for hackathon evaluation; it is not an operational flood-warning system.

## Prediction target

The selected target is daily raw discharge:

`''
target = discharge_cfs
```

Area-normalized discharge remains available for validation comparisons but is
not used by the final model. Predictions are in cfs and are clipped to
non-negative values.

## Models

The fixed ensemble contains:

| Model | Wet-regime weight | Dry-regime weight |
|-------|------------------:|------------------:|
| HistGradientBoosting (`hgb`) | 0.50 | 0.50 |
| CatBoost (`cat`) | 0.35 | 0.35 |
| LightGBM (`lgb`) | 0.15 | 0.15 |

ExtraTrees and XGBoost are excluded. The same 50/35/15 blend is used in all
conditions; wet/dry regime detection does not change those weights.

## Inputs and features

Predictors include daily precipitation, maximum and minimum temperature, soil moisture, drainage area, elevation, slope, forest cover, seasonal encodings, causal weather lags, rolling precipitation totals, and antecedent precipitation features. Station identifiers are retained for joins and output but are not model features. The target is never included in feature engineering.

## Validation and judging metrics

Validation holds out complete stations. Extreme-event RMSE uses actual discharge at or above the held-out station's 90th percentile for scoring only. The composite uses min-max-normalized metrics and the specified weights:

| Metric | Weight | Direction |
|---|---:|---|
| Overall RMSE | 40% | Lower is better |
| Extreme-event RMSE | 30% | Lower is better |
| MAE | 20% | Lower is better |
| R² | 10% | Higher is better |

The official normalization bounds depend on all submissions. Before those values are published, the code can calculate a local candidate-range proxy; that proxy is not the final leaderboard score.

## Example validation result

The expanded training set has 24 gauges. In the identical station-grouped
out-of-fold comparison, the pooled results were:

| Metric | Raw-discharge target | Specific-discharge target |
|---|---:|---:|
| Overall RMSE | 58,507.37 cfs | 98,465.34 cfs |
| Extreme-event RMSE | 114,017.44 cfs | 196,579.16 cfs |
| MAE | 12,542.88 cfs | 14,845.48 cfs |
| R² | 0.0141 | -1.7923 |

Raw discharge improved all four pooled metrics in this comparison. The
normalized local score is 100 for raw discharge and 0 for specific discharge
because only those two candidates are compared; it is not an accuracy
percentage or official leaderboard score. See
`reports/target_comparison.json` for fold-level
details. The separate test gauge has no discharge labels, so no test accuracy
is claimed.

A follow-up eight-fold station-held-out check compared the current raw blend
with several CatBoost settings and a `log1p(raw discharge)` blend. No candidate
improved all four metrics, so the production configuration was retained.
Results and tested settings are in `reports/parameter_tuning.md`.

## Data and limitations

The default uses 24 training gauges and one held-out test gauge in
`data/expanded_24_station/`. The original four-gauge example remains under
`data/raw/`. These are supplemental API-acquired observations, not
organizer-provided test labels. Even the expanded cross-validation results
cannot establish reliable transfer to arbitrary basins. The unseen test
gauge's discharge was not collected; no test accuracy can be claimed.

Weather is same-day historical data, so predictions are not lead-time forecasts unless future weather forecasts are supplied. API coverage and basin attributes vary by station. Do not use these predictions for public warnings, evacuation, or infrastructure operation.

## Reproduction and saved artifacts

From the project root, install `requirements.txt`, then run:

```bash
python solution.py
python validate_submission.py
python -m unittest discover -s tests -v
```

The training command writes the final fitted model and metadata to
`models/floodcast_final.joblib`, the submission to `predictions.csv`, and
station-held-out reports to `reports/`. The artifact records the exact feature
names, `hydro_plus` schema, ensemble weights, and target mode. Use
`python solution.py --skip-validation` only after reviewing
the saved out-of-fold comparison when a faster final refit is needed.

The score weights remain 40% overall RMSE, 30% station-specific top-decile
RMSE, 20% MAE, and 10% R². The official normalized score requires the
leaderboard's all-team best and worst values. Until provided, the local score
is normalized over the two compared target modes and must not be interpreted
as an official score.
