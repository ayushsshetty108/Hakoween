"""Train the selected discharge blend, validate, and write prediction.csv."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from src.data.preprocessing import TARGET, SUBMISSION_COLUMNS, load_inputs
from src.hydrology.features import make_features
from src.models.ensemble import RegimeGatedBlender
from src.models.flood_detection import SpecificDischargeTransformer
from src.validation.cross_validation import build_station_error_report, run_target_comparison

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT_DIR = "data/expanded_24_station"
DEFAULT_TARGET_MODE = "raw_discharge"


def _project_path(path: str | Path) -> Path:
    """Resolve relative CLI paths from this project, not VS Code's launch cwd."""
    candidate = Path(path)
    return candidate if candidate.is_absolute() else PROJECT_ROOT / candidate


def verify_submission_guardrails(test_df: pd.DataFrame, predictions: pd.DataFrame) -> None:
    """Enforce the output schema, order, row count, and non-negative finite flow."""
    if list(predictions.columns) != ["station_id", "date", "discharge_cfs"]:
        raise ValueError("Prediction output must contain exactly station_id, date, discharge_cfs in that order")
    if len(predictions) != len(test_df):
        raise ValueError(f"Prediction row count {len(predictions)} != test row count {len(test_df)}")
    expected_station = test_df["station_id"].astype(str).reset_index(drop=True)
    actual_station = predictions["station_id"].astype(str).reset_index(drop=True)
    if not expected_station.equals(actual_station):
        raise ValueError("Prediction station_id values or row order do not match test.csv")
    expected_dates = pd.to_datetime(test_df["date"], errors="raise").dt.strftime("%Y-%m-%d").reset_index(drop=True)
    actual_dates = pd.to_datetime(predictions["date"], errors="raise").dt.strftime("%Y-%m-%d").reset_index(drop=True)
    if not expected_dates.equals(actual_dates):
        raise ValueError("Prediction dates or row order do not match test.csv")
    q = pd.to_numeric(predictions["discharge_cfs"], errors="coerce").to_numpy(dtype=float)
    if not np.isfinite(q).all():
        raise ValueError("Predictions contain missing or non-finite discharge")
    if (q < 0.0).any():
        raise ValueError("Negative discharge predictions are disqualifying")


def _load_context(input_dir: str | Path) -> pd.DataFrame | None:
    path = Path(input_dir) / "feature_context.csv"
    if not path.exists():
        return None
    frame = pd.read_csv(path, dtype={"station_id": "string"})
    frame["date"] = pd.to_datetime(frame["date"], errors="raise").dt.normalize()
    return frame


def run(input_dir=DEFAULT_INPUT_DIR, output="prediction.csv", report_dir="reports",
        target_mode=DEFAULT_TARGET_MODE, artifact_path="models/floodcast_final.joblib",
        run_validation=True) -> dict:
    input_root = _project_path(input_dir)
    train_df, test_df = load_inputs(input_root)
    context = _load_context(input_root)
    X_train, X_test = make_features(train_df, test_df, context=context, feature_set="hydro_plus")

    if list(X_train.columns) != list(X_test.columns):
        raise ValueError("Training and test feature schemas differ")
    feature_names = list(X_train.columns)
    if not feature_names or not X_train.select_dtypes(include=[np.number]).columns.tolist():
        raise ValueError("No numeric model features were generated")

    report_root = _project_path(report_dir)
    report_root.mkdir(parents=True, exist_ok=True)
    comparison = None
    if run_validation:
        comparison = run_target_comparison(train_df, X_train)
        report_json = {key: value for key, value in comparison.items() if key != "oof_predictions"}
        (report_root / "target_comparison.json").write_text(json.dumps(report_json, indent=2), encoding="utf-8")
        for mode, frame in comparison["oof_predictions"].items():
            frame.to_csv(report_root / f"oof_{mode}.csv", index=False, encoding="utf-8")
            station_report = build_station_error_report(frame)
            station_report.to_csv(report_root / f"per_station_{mode}.csv", index=False, encoding="utf-8")

    if target_mode not in {"raw_discharge", "specific_discharge"}:
        raise ValueError("target_mode must be raw_discharge or specific_discharge")
    q_train = pd.to_numeric(train_df[TARGET], errors="raise").to_numpy(dtype=float)
    area_train = pd.to_numeric(train_df["drainage_area_sqmi"], errors="coerce").to_numpy(dtype=float)
    area_test = pd.to_numeric(test_df["drainage_area_sqmi"], errors="coerce").to_numpy(dtype=float)
    if target_mode == "specific_discharge":
        transformer = SpecificDischargeTransformer(use_log=False).fit(q_train, area_train)
        y_fit = transformer.transform(q_train, area_train)
    else:
        transformer = None
        y_fit = q_train

    blender = RegimeGatedBlender().fit(X_train, y_fit)
    predicted_target = blender.predict(X_test)
    predicted_cfs = (transformer.inverse_transform(predicted_target, area_test)
                     if transformer is not None else np.maximum(predicted_target, 0.0))
    if not np.isfinite(predicted_cfs).all():
        raise ValueError("Model produced non-finite discharge; refusing to hide invalid predictions")
    predicted_cfs = np.maximum(predicted_cfs, 0.0)

    artifact = {
        "model": blender,
        "target_transformer": transformer,
        "target_mode": target_mode,
        "feature_names": feature_names,
        "feature_set": "hydro_plus",
        "model_family": "fixed_hgb_catboost_lightgbm_blend",
        "ensemble_weights": dict(RegimeGatedBlender.REGIME_WEIGHTS["wet"]),
        "random_state": 42,
        "use_log": False,
    }
    artifact_destination = _project_path(artifact_path)
    artifact_destination.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, artifact_destination)
    submission = pd.DataFrame({
        "station_id": test_df["station_id"].astype(str).to_numpy(),
        "date": pd.to_datetime(test_df["date"]).dt.strftime("%Y-%m-%d").to_numpy(),
        "discharge_cfs": predicted_cfs,
    }, columns=SUBMISSION_COLUMNS)
    verify_submission_guardrails(test_df, submission)

    destination = _project_path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    submission.to_csv(destination, index=False, encoding="utf-8")
    serialized = pd.read_csv(destination, dtype={"station_id": "string"})
    verify_submission_guardrails(test_df, serialized)
    result = {
        "prediction_file": str(destination),
        "model_artifact": str(artifact_destination),
        "rows": len(serialized),
        "target_mode": target_mode,
        "transform_use_log": False,
        "feature_count": len(feature_names),
        "guardrails": "PASS",
    }
    if comparison is not None:
        result["local_weighted_scores"] = comparison["local_weighted_scores"]
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output", default="prediction.csv")
    parser.add_argument("--report-dir", default="reports")
    parser.add_argument("--artifact", default="models/floodcast_final.joblib")
    parser.add_argument("--skip-validation", action="store_true", help="Skip station-held-out OOF comparison")
    parser.add_argument("--target-mode", choices=["specific_discharge", "raw_discharge"], default=DEFAULT_TARGET_MODE)
    args = parser.parse_args()
    print(json.dumps(run(args.input_dir, args.output, args.report_dir, args.target_mode,
                         args.artifact, not args.skip_validation), indent=2))
