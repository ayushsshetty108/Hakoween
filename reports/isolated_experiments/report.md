# FLOODCAST isolated experiment results

## Scope

Three candidates were run on the same current `hydro_plus` feature matrix and the same four Leave-One-Station-Out folds. Each station was held out once. The production model, model artifact, official scoring implementation, and `predictions.csv` were not changed.

The training targets contain 13,147 rows, and their discharge values match the official USGS download for every station-date key. All candidates returned predictions in cfs after inverse conversion; negative values were clipped at zero before scoring.

## Pooled out-of-fold metrics

| Candidate | Target | Model | Overall RMSE ↓ | Extreme RMSE ↓ | MAE ↓ | R² ↑ | Local weighted score / 100 |
|---|---|---|---:|---:|---:|---:|---:|
| Specific-discharge baseline | Q/A | Current HGB + CatBoost + LightGBM blend | 128,111.24 | 234,625.03 | 61,701.65 | 0.0286 | 22.47 |
| Log-specific ablation | log1p(Q/A) | Same fixed blend | 127,631.30 | 240,363.64 | 61,898.69 | 0.0358 | 7.12 |
| CatBoost-only | Q/A | CatBoost only | 124,734.99 | 231,495.77 | 60,610.53 | 0.0791 | 100.00 |

The official metric weights remain **40% overall RMSE, 30% extreme-event RMSE, 20% MAE, and 10% R²**. Extreme-event RMSE is computed only on held-out actual discharge at or above that station's 90th percentile.

The local weighted scores normalize each metric across only these three candidates using the official min-max direction, then apply the 40/30/20/10 weights. They are local comparison scores, **not** official leaderboard scores; the official normalization requires all-team best and worst values.

## Station-held-out breakdown

| Held-out station | Baseline RMSE | Log RMSE | CatBoost RMSE | Baseline extreme RMSE | Log extreme RMSE | CatBoost extreme RMSE |
|---|---:|---:|---:|---:|---:|---:|
| 01646500 | 15,729.56 | 15,991.64 | 17,215.78 | 46,244.91 | 47,125.01 | 50,042.22 |
| 02087500 | 1,077.42 | 1,017.25 | 1,050.89 | 2,347.99 | 2,750.08 | 2,869.90 |
| 07010000 | 252,514.14 | 252,783.51 | 246,197.43 | 461,319.70 | 474,374.38 | 455,689.69 |
| 08158000 | 40,416.52 | 31,592.23 | 36,335.59 | 61,655.49 | 48,154.21 | 52,868.10 |

The CatBoost-only candidate has the best pooled result on all four metrics in this run. Its fold results are mixed: it is worse than the baseline on all four metrics at station `01646500`, and has worse extreme RMSE at `02087500`. The log transform improves pooled RMSE and R² slightly but worsens pooled extreme RMSE and MAE. The evidence supports keeping both as experimental findings; it does not establish reliable generalization from only four held-out basins.

## Reproduction and artifacts

Run from the project root:

```bash
python -m src.validation.isolated_experiments
```

- `comparison.json`: weights, normalization bounds, pooled metrics, each fold's metrics, and target/model settings.
- `comparison.csv`: compact pooled comparison table.
- `oof_specific_baseline.csv`, `oof_log_specific.csv`, `oof_specific_catboost.csv`: held-out predictions for audit.

The `log1p` transform is implemented only in this experiment runner. Production still uses the existing `SpecificDischargeTransformer(use_log=False)` and remains unchanged.
