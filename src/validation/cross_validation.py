"""Station-held-out validation and the FLOODCAST weighted scoring rubric."""
from __future__ import annotations

import os
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut

from src.models.ensemble import RegimeGatedBlender
from src.models.flood_detection import SpecificDischargeTransformer

METRIC_WEIGHTS = {
    "overall_rmse": 0.40,
    "extreme_rmse": 0.30,
    "mae": 0.20,
    "r2": 0.10,
}


def compute_extreme_rmse(
    df_eval: pd.DataFrame,
    y_true_col: str = "discharge_cfs",
    y_pred_col: str = "pred_cfs",
    quantile: float = 0.90,
) -> float:
    """Compute RMSE on actual-flow values at or above each station's q90."""
    if not 0.0 < quantile < 1.0:
        raise ValueError("quantile must be between 0 and 1")
    selected = []
    for _, group in df_eval.groupby("station_id", sort=False):
        threshold = float(group[y_true_col].quantile(quantile))
        selected.extend(group.index[group[y_true_col] >= threshold].tolist())
    if not selected:
        return float("nan")
    subset = df_eval.loc[selected]
    return float(np.sqrt(mean_squared_error(subset[y_true_col], subset[y_pred_col])))


def evaluate_predictions(
    df_eval: pd.DataFrame,
    y_true_col: str = "discharge_cfs",
    y_pred_col: str = "pred_cfs",
) -> dict:
    """Compute the four official metrics; callers should pass cfs predictions."""
    y_true = np.asarray(df_eval[y_true_col], dtype=float)
    y_pred = np.maximum(np.asarray(df_eval[y_pred_col], dtype=float), 0.0)
    if len(y_true) == 0 or len(y_true) != len(y_pred):
        raise ValueError("Evaluation data must contain aligned, non-empty targets and predictions")
    if not np.isfinite(y_true).all() or not np.isfinite(y_pred).all():
        raise ValueError("Evaluation targets and predictions must be finite")
    pred_frame = df_eval.copy()
    pred_frame[y_pred_col] = y_pred
    return {
        "overall_rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "extreme_rmse": compute_extreme_rmse(pred_frame, y_true_col, y_pred_col, quantile=0.90),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)) if len(y_true) > 1 else 0.0,
    }


def compute_weighted_score(metrics: dict, best_scores: dict, worst_scores: dict) -> tuple[float, dict]:
    """Apply official min-max normalization and 40/30/20/10 weighting.

    `best_scores` and `worst_scores` should be the all-team leaderboard ranges
    when available. For local CV, pass the best/worst candidate values instead.
    """
    higher_is_better = {"r2"}
    normalized = {}
    for metric in METRIC_WEIGHTS:
        best = float(best_scores[metric])
        worst = float(worst_scores[metric])
        value = float(metrics[metric])
        if best == worst:
            normalized[metric] = 100.0
        elif metric in higher_is_better:
            normalized[metric] = 100.0 * (value - worst) / (best - worst)
        else:
            normalized[metric] = 100.0 * (worst - value) / (worst - best)
    total = sum(METRIC_WEIGHTS[key] * normalized[key] for key in METRIC_WEIGHTS)
    return float(total), normalized


def _candidate_bounds(candidate_metrics: dict) -> tuple[dict, dict]:
    best, worst = {}, {}
    for metric in METRIC_WEIGHTS:
        values = [float(item[metric]) for item in candidate_metrics.values()]
        if metric == "r2":
            best[metric], worst[metric] = max(values), min(values)
        else:
            best[metric], worst[metric] = min(values), max(values)
    return best, worst


def get_station_splits(df: pd.DataFrame, max_folds: int = 8):
    """Return grouped folds; a station never appears in both sides of a fold."""
    n_stations = int(df["station_id"].nunique())
    if n_stations < 2:
        raise ValueError("At least two stations are required for station-held-out validation")
    splitter = LeaveOneGroupOut() if n_stations <= max_folds else GroupKFold(n_splits=max_folds)
    return splitter.split(df, df["discharge_cfs"], groups=df["station_id"].astype(str))


def run_target_comparison(train_df: pd.DataFrame, feature_matrix: pd.DataFrame) -> dict:
    """Compare raw Q and Q/A using the same station-held-out folds and ensemble."""
    if len(train_df) != len(feature_matrix):
        raise ValueError("feature_matrix must preserve the train_df row order and length")
    modes = ("raw_discharge", "specific_discharge")
    oof = {mode: np.full(len(train_df), np.nan, dtype=float) for mode in modes}
    fold_rows = []
    area = pd.to_numeric(train_df["drainage_area_sqmi"], errors="coerce").to_numpy(dtype=float)
    q = pd.to_numeric(train_df["discharge_cfs"], errors="coerce").to_numpy(dtype=float)
    if not np.isfinite(area).all() or (area <= 0).any():
        raise ValueError("Specific-discharge comparison requires finite positive drainage area on every row")

    for fold_id, (train_idx, valid_idx) in enumerate(get_station_splits(train_df), start=1):
        fold_info = {"fold": fold_id, "held_out_stations": sorted(train_df.iloc[valid_idx].station_id.astype(str).unique().tolist()), "models": {}}
        for mode in modes:
            blender = RegimeGatedBlender()
            if mode == "specific_discharge":
                transformer = SpecificDischargeTransformer(use_log=False).fit(q[train_idx], area[train_idx])
                y_fit = transformer.transform(q[train_idx], area[train_idx])
            else:
                transformer = None
                y_fit = q[train_idx]
            blender.fit(feature_matrix.iloc[train_idx], y_fit)
            pred_target = blender.predict(feature_matrix.iloc[valid_idx])
            pred_cfs = (transformer.inverse_transform(pred_target, area[valid_idx])
                        if transformer is not None else np.maximum(pred_target, 0.0))
            oof[mode][valid_idx] = pred_cfs
            scored = train_df.iloc[valid_idx][["station_id", "discharge_cfs"]].copy()
            scored["pred_cfs"] = pred_cfs
            fold_info["models"][mode] = evaluate_predictions(scored)
        fold_rows.append(fold_info)

    if any(not np.isfinite(pred).all() for pred in oof.values()):
        raise RuntimeError("OOF predictions are incomplete")
    candidate_metrics = {}
    oof_frames = {}
    for mode, pred in oof.items():
        frame = train_df[["station_id", "date", "discharge_cfs", "drainage_area_sqmi"]].copy()
        frame["pred_cfs"] = pred
        oof_frames[mode] = frame
        candidate_metrics[mode] = evaluate_predictions(frame)
    best, worst = _candidate_bounds(candidate_metrics)
    weighted = {}
    components = {}
    for mode, metrics in candidate_metrics.items():
        weighted[mode], components[mode] = compute_weighted_score(metrics, best, worst)
    return {
        "split": "LeaveOneGroupOut by station (GroupKFold only above 8 stations)",
        "target_modes": list(modes),
        "specific_transform_use_log": False,
        "folds": fold_rows,
        "metrics": candidate_metrics,
        "normalization_best": best,
        "normalization_worst": worst,
        "local_weighted_scores": weighted,
        "normalized_components": components,
        "normalization_note": "Local min-max uses the compared OOF target modes. Official all-team min/max values can be supplied to compute_weighted_score when published.",
        "oof_predictions": oof_frames,
    }


def build_station_error_report(oof_df: pd.DataFrame) -> pd.DataFrame:
    """Summarize full and top-decile errors per held-out station."""
    rows = []
    for station_id, group in oof_df.groupby("station_id", sort=False):
        metrics = evaluate_predictions(group)
        q90 = float(group["discharge_cfs"].quantile(0.90))
        peaks = group[group["discharge_cfs"] >= q90]
        rows.append({
            "station_id": str(station_id), "n_days": len(group),
            "drainage_area_sqmi": float(group["drainage_area_sqmi"].iloc[0]),
            **metrics,
            "peak_mean_bias_cfs": float((peaks["pred_cfs"] - peaks["discharge_cfs"]).mean()),
        })
    return pd.DataFrame(rows).sort_values("extreme_rmse", ascending=False)


def log_experiment(exp_id: str, features_desc: str, model_name: str,
                   fold_strategy: str, metrics: dict, weighted_score: float,
                   keep: bool, log_path: str = "reports/experiment_log.csv") -> None:
    """Append one auditable model-comparison row."""
    parent = os.path.dirname(log_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    row = pd.DataFrame([{
        "experiment": exp_id, "features": features_desc, "model": model_name,
        "fold_strategy": fold_strategy, **metrics,
        "weighted_score": weighted_score, "keep": bool(keep),
    }])
    row.to_csv(log_path, mode="a", index=False, header=not os.path.exists(log_path))
