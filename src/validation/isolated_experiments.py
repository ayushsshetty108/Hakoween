"""Run the requested isolated target/model comparisons without changing production.

Experiments use the same Leave-One-Station-Out folds, feature matrix, target rows,
and official metric definitions as the V2 validation module. The local weighted
score is normalized across these candidates only; it is not a leaderboard score.
"""
from __future__ import annotations

import json
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.data.preprocessing import load_inputs
from src.hydrology.features import make_features
from src.models.ensemble import RegimeGatedBlender
from src.models.flood_detection import SpecificDischargeTransformer
from src.models.train_models import build_model_set
from src.validation.cross_validation import (
    METRIC_WEIGHTS,
    compute_weighted_score,
    evaluate_predictions,
    get_station_splits,
)


EXPERIMENTS = {
    "specific_baseline": "Specific discharge Q/A with the current fixed HGB/CatBoost/LightGBM blend",
    "log_specific": "log1p(Q/A) with the same fixed HGB/CatBoost/LightGBM blend",
    "specific_catboost": "Specific discharge Q/A with CatBoost only",
}


def _aligned_features(train: pd.DataFrame, test: pd.DataFrame, input_dir: Path):
    context_path = input_dir / "feature_context.csv"
    context = None
    if context_path.exists():
        context = pd.read_csv(context_path, dtype={"station_id": "string"})
        context["date"] = pd.to_datetime(context["date"], errors="raise").dt.normalize()
    X_train, _ = make_features(train, test, context=context, feature_set="hydro_plus")
    return X_train


def _fit_predict(experiment: str, X_train: pd.DataFrame, q_train: np.ndarray,
                 area_train: np.ndarray, train_idx: np.ndarray,
                 valid_idx: np.ndarray) -> np.ndarray:
    transform = SpecificDischargeTransformer(use_log=False)
    transform.fit(q_train[train_idx], area_train[train_idx])
    specific_fit = transform.transform(q_train[train_idx], area_train[train_idx])

    if experiment == "specific_baseline":
        model = RegimeGatedBlender(random_state=42).fit(X_train.iloc[train_idx], specific_fit)
        pred_specific = model.predict(X_train.iloc[valid_idx])
        pred_cfs = transform.inverse_transform(pred_specific, area_train[valid_idx])
    elif experiment == "log_specific":
        model = RegimeGatedBlender(random_state=42).fit(
            X_train.iloc[train_idx], np.log1p(specific_fit)
        )
        pred_log_specific = model.predict(X_train.iloc[valid_idx])
        pred_specific = np.expm1(pred_log_specific)
        if not np.isfinite(pred_specific).all():
            raise FloatingPointError("log1p inverse transform produced non-finite specific discharge")
        pred_cfs = transform.inverse_transform(pred_specific, area_train[valid_idx])
    elif experiment == "specific_catboost":
        model = build_model_set(random_state=42)["cat"]
        model.fit(X_train.iloc[train_idx], specific_fit)
        pred_specific = model.predict(X_train.iloc[valid_idx])
        pred_cfs = transform.inverse_transform(pred_specific, area_train[valid_idx])
    else:
        raise ValueError(f"Unknown experiment: {experiment}")
    if not np.isfinite(pred_cfs).all():
        raise FloatingPointError(f"{experiment} produced non-finite discharge predictions")
    return np.maximum(np.asarray(pred_cfs, dtype=float), 0.0)


def run_experiments(input_dir: str | Path = "data/raw",
                    output_dir: str | Path = "reports/isolated_experiments",
                    experiments: list[str] | None = None) -> dict:
    input_root = Path(input_dir)
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    experiment_names = list(experiments or EXPERIMENTS)
    unknown = sorted(set(experiment_names) - set(EXPERIMENTS))
    if not experiment_names or unknown:
        raise ValueError(f"Choose one or more known experiments; unknown={unknown}")
    train, test = load_inputs(input_root)
    X_train = _aligned_features(train, test, input_root)
    area = pd.to_numeric(train["drainage_area_sqmi"], errors="raise").to_numpy(dtype=float)
    q = pd.to_numeric(train["discharge_cfs"], errors="raise").to_numpy(dtype=float)
    if not np.isfinite(area).all() or (area <= 0).any():
        raise ValueError("All training rows need finite positive drainage area for Q/A experiments")

    # Hold out exactly one station per fold, including expanded datasets with
    # more than eight gauges. The four-station experiment therefore remains 4-fold.
    splits = list(get_station_splits(train, max_folds=int(train["station_id"].nunique())))
    if len(splits) != train["station_id"].nunique():
        raise RuntimeError(
            f"Expected one held-out fold per station ({train['station_id'].nunique()}), got {len(splits)}"
        )
    predictions = {key: np.full(len(train), np.nan, dtype=float) for key in experiment_names}
    fold_results = []
    for fold, (train_idx, valid_idx) in enumerate(splits, start=1):
        station_ids = sorted(train.iloc[valid_idx].station_id.astype(str).unique().tolist())
        row = {"fold": fold, "held_out_stations": station_ids, "validation_rows": len(valid_idx), "metrics": {}}
        for experiment in experiment_names:
            pred = _fit_predict(experiment, X_train, q, area, train_idx, valid_idx)
            predictions[experiment][valid_idx] = pred
            scored = train.iloc[valid_idx][["station_id", "discharge_cfs"]].copy()
            scored["pred_cfs"] = pred
            row["metrics"][experiment] = evaluate_predictions(scored)
        fold_results.append(row)

    metrics, oof_frames = {}, {}
    for experiment in experiment_names:
        description = EXPERIMENTS[experiment]
        pred = predictions[experiment]
        if not np.isfinite(pred).all():
            raise RuntimeError(f"Incomplete OOF predictions for {experiment}")
        frame = train[["station_id", "date", "discharge_cfs", "drainage_area_sqmi"]].copy()
        frame["pred_cfs"] = pred
        metrics[experiment] = evaluate_predictions(frame)
        oof_frames[experiment] = frame
        frame.to_csv(output_root / f"oof_{experiment}.csv", index=False, encoding="utf-8")

    bounds, weighted, normalized = {}, {}, {}
    if len(experiment_names) > 1:
        for metric in METRIC_WEIGHTS:
            values = [result[metric] for result in metrics.values()]
            bounds[metric] = {
                "best": max(values) if metric == "r2" else min(values),
                "worst": min(values) if metric == "r2" else max(values),
            }
        best = {metric: values["best"] for metric, values in bounds.items()}
        worst = {metric: values["worst"] for metric, values in bounds.items()}
        for experiment in experiment_names:
            weighted[experiment], normalized[experiment] = compute_weighted_score(metrics[experiment], best, worst)

    result = {
        "scope": "isolated experiments; production model and predictions were not modified",
        "fold_strategy": "LeaveOneGroupOut by station; identical fold indices for every experiment",
        "fold_count": len(splits),
        "held_out_station_per_fold": [row["held_out_stations"] for row in fold_results],
        "features": "same hydro_plus feature matrix for all candidates",
        "target_configurations": {key: {
            "specific_baseline": "Q / drainage_area_sqmi",
            "log_specific": "log1p(Q / drainage_area_sqmi); inverse expm1 then multiply by area",
            "specific_catboost": "Q / drainage_area_sqmi",
        }[key] for key in experiment_names},
        "model_configurations": {key: {
            "specific_baseline": "fixed HGB/CatBoost/LightGBM blend, weights 50/35/15 in wet and dry regimes",
            "log_specific": "same fixed HGB/CatBoost/LightGBM blend and weights",
            "specific_catboost": "CatBoost only, using current CatBoost component hyperparameters",
        }[key] for key in experiment_names},
        "metric_weights": METRIC_WEIGHTS,
        "metrics": metrics,
        "local_normalization_bounds": bounds,
        "local_weighted_scores": weighted,
        "normalized_components": normalized,
        "score_note": ("The 40/30/20/10 weights are preserved. Normalization uses only these local candidates because official all-team best/worst values are unavailable; local scores are not official leaderboard scores."
                       if len(experiment_names) > 1 else "The 40/30/20/10 weights are preserved and all four metrics are reported. A weighted composite is omitted for this single candidate because valid min-max score bounds require other candidates or official all-team ranges."),
        "fold_results": fold_results,
        "experiment_descriptions": {key: EXPERIMENTS[key] for key in experiment_names},
    }
    (output_root / "comparison.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")

    rows = []
    for experiment in experiment_names:
        description = EXPERIMENTS[experiment]
        rows.append({
            "experiment": experiment,
            "description": description,
            **metrics[experiment],
            "local_weighted_score_0_100": weighted.get(experiment),
        })
    pd.DataFrame(rows).to_csv(output_root / "comparison.csv", index=False, encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run isolated FLOODCAST target/model experiments.")
    parser.add_argument("--input-dir", default="data/raw")
    parser.add_argument("--output-dir", default="reports/isolated_experiments")
    parser.add_argument("--experiments", nargs="+", choices=list(EXPERIMENTS), default=None)
    args = parser.parse_args()
    print(json.dumps(run_experiments(args.input_dir, args.output_dir, args.experiments), indent=2, default=str))
