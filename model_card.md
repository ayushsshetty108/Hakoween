# FLOODCAST V2 Model Card

## Author

**PREETHAM B**  
Artificial Intelligence and Machine Learning Department  
BMS Institute of Technology and Management

## Intended use

Offline prediction of daily river discharge at stations not used for model fitting. This prototype is for hackathon evaluation; it is not an operational flood-warning system.

## Prediction target

The V2 target is specific discharge:

```text
specific_discharge = discharge_cfs / drainage_area_sqmi
predicted_discharge_cfs = predicted_specific_discharge * drainage_area_sqmi
```

The transformer enforces `use_log=False`. Final predictions are in cfs and are clipped to non-negative values.

## Models

The regime-gated ensemble contains only:

| Model | Wet-regime weight | Dry-regime weight |
|---|---:|---:|
| HistGradientBoosting (`hgb`) | 0.50 | 0.50 |
| CatBoost (`cat`) | 0.35 | 0.35 |
| LightGBM (`lgb`) | 0.15 | 0.15 |

ExtraTrees and XGBoost are excluded. Wet/dry classification uses precipitation and soil moisture; the required blend weights are identical in both regimes.

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

The bundled example has four training gauges. With the fixed ensemble and identical leave-one-station-out folds, the pooled results were:

| Metric | Raw-discharge target | Specific-discharge target |
|---|---:|---:|
| Overall RMSE | 146,080.88 cfs | 128,111.24 cfs |
| Extreme-event RMSE | 280,308.96 cfs | 234,625.03 cfs |
| MAE | 73,969.72 cfs | 61,701.65 cfs |
| R² | -0.2631 | 0.0286 |

Specific discharge lowered RMSE on three of four held-out gauges. It raised RMSE at station 08158000 from 29,077.79 to 40,416.52 cfs. The separate California example test gauge has no discharge labels, so no test accuracy is claimed. The score values in `reports/target_comparison.json` are normalized only across the two tested target modes; they are not official leaderboard scores.

## Data and limitations

The included train/test CSVs are API-generated examples, not organizer-provided data. They contain four training gauges and one held-out gauge; the test gauge's discharge was not collected. This small sample cannot establish reliable transfer to arbitrary basins. The fixed weighted blend and the V2 target scale are experiment choices, not guaranteed improvements. Review `reports/target_comparison.json` and per-station OOF diagnostics before selecting a model for an official run.

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
names, `hydro_plus` schema, ensemble weights, target mode, and disabled log
transformation. Use `python solution.py --skip-validation` only after reviewing
the saved out-of-fold comparison when a faster final refit is needed.

The score weights are 40% overall RMSE, 30% station-specific top-decile RMSE,
20% MAE, and 10% R². The official normalized score requires the leaderboard's
all-team best and worst values. Until provided, the bundled local score is
normalized over the two compared target modes and must not be interpreted as an
official score.
