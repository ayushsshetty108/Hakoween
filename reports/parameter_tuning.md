# Parameter tuning check

## Validation setup

Candidates were evaluated on the expanded 24-station training data with the
same `hydro_plus` features and eight GroupKFold splits by station used for the
saved raw-discharge out-of-fold predictions. No station appears in both sides
of a fold. The production artifact and `predictions.csv` were not changed.

## Results

| Candidate | Overall RMSE (cfs) | Top-decile RMSE (cfs) | MAE (cfs) | R² |
|---|---:|---:|---:|---:|
| Current raw-discharge blend | 58,507.37 | 114,017.44 | 12,542.88 | 0.0141 |
| CatBoost raw, current settings | 58,994.35 | 114,738.18 | 12,816.56 | -0.0023 |
| CatBoost raw, depth 4 / 320 iterations / learning rate 0.04 / L2 8 | 58,665.34 | 114,175.14 | 12,765.61 | 0.0088 |
| CatBoost raw, depth 8 / 240 iterations / learning rate 0.03 / L2 8 | 59,150.80 | 115,009.24 | 12,904.94 | -0.0077 |
| `log1p(raw discharge)` blend, inverse-transformed | 59,459.23 | 115,153.62 | 12,471.08 | -0.0182 |

The current blend used `hgb=0.50`, `cat=0.35`, and `lgb=0.15` for both
regimes. CatBoost candidates used the existing median imputation pipeline.
The `log1p` candidate used the current blend and the same fold assignments.

## Decision

Keep the current production configuration. The log-target blend reduced MAE by
about 72 cfs, but worsened both RMSE metrics and R². None of the tested
CatBoost settings improved any pooled metric over the current model. Selecting
a candidate based only on one metric would trade off overall and high-flow
performance without a clear net improvement.

This is a limited model-selection check on 24 gauges, not evidence that the
model predicts an arbitrary unseen basin accurately. In particular, high-flow
RMSE remains large; further gains likely require better basin-level predictors
and/or observations from more diverse gauges, not unvalidated parameter
changes.
