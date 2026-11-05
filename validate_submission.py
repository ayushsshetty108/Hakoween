"""Validate predictions.csv against the exact test.csv keys and ordering."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np
import pandas as pd

EXPECTED_COLUMNS = ["station_id", "date", "discharge_cfs"]
PROJECT_ROOT = Path(__file__).resolve().parent


def _project_path(path: str | Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else PROJECT_ROOT / candidate


def validate_submission(test_path: str | Path, predictions_path: str | Path) -> list[tuple[str, bool, str]]:
    test_path, predictions_path = _project_path(test_path), _project_path(predictions_path)
    results: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str) -> None:
        results.append((name, bool(ok), detail))

    try:
        test = pd.read_csv(test_path, dtype={"station_id": "string"})
        pred = pd.read_csv(predictions_path, dtype={"station_id": "string"})
    except Exception as exc:
        return [("CSV files readable", False, str(exc))]

    record("Exact columns and order", list(pred.columns) == EXPECTED_COLUMNS,
           f"found {list(pred.columns)}; expected {EXPECTED_COLUMNS}")
    record("Prediction row count", len(pred) == len(test),
           f"predictions={len(pred)}, test={len(test)}")
    accidental_index = any(str(c).lower().startswith("unnamed:") or str(c).lower() in {"index", "level_0"}
                           for c in pred.columns)
    record("No accidental index column", not accidental_index,
           "index column detected" if accidental_index else "none detected")

    needed = {"station_id", "date"}
    if needed.issubset(test.columns) and needed.issubset(pred.columns):
        test_keys = test[["station_id", "date"]].copy()
        pred_keys = pred[["station_id", "date"]].copy()
        for frame in (test_keys, pred_keys):
            frame["station_id"] = frame["station_id"].astype("string").str.strip()
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.strftime("%Y-%m-%d")
        duplicate = bool(pred_keys.duplicated().any())
        record("No duplicate station-date predictions", not duplicate,
               f"duplicates={int(pred_keys.duplicated().sum())}")
        key_counts_match = (not test_keys.duplicated().any() and not duplicate and
                            len(pred_keys) == len(test_keys) and
                            pred_keys.sort_values(["station_id", "date"]).reset_index(drop=True).equals(
                                test_keys.sort_values(["station_id", "date"]).reset_index(drop=True)))
        record("Every test station-date appears exactly once", key_counts_match,
               "prediction keys match test keys" if key_counts_match else "missing, extra, or repeated key")
        ordered = pred_keys.reset_index(drop=True).equals(test_keys.reset_index(drop=True))
        record("Original test-row ordering preserved", ordered,
               "keys align row-for-row" if ordered else "prediction key order differs from test.csv")
    else:
        for name in ("No duplicate station-date predictions", "Every test station-date appears exactly once",
                     "Original test-row ordering preserved"):
            record(name, False, "station_id/date columns are missing")

    if "discharge_cfs" in pred.columns:
        values = pd.to_numeric(pred["discharge_cfs"], errors="coerce").to_numpy(dtype=float)
        finite = bool(np.isfinite(values).all())
        record("No missing or non-finite predictions", finite,
               f"invalid={int((~np.isfinite(values)).sum())}")
        nonnegative = finite and bool((values >= 0).all())
        record("No negative discharge", nonnegative,
               f"negative={int((values < 0).sum()) if finite else 'not evaluated'}")
    else:
        record("No missing or non-finite predictions", False, "discharge_cfs column is missing")
        record("No negative discharge", False, "discharge_cfs column is missing")
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default=str(PROJECT_ROOT / "data/raw/test.csv"))
    parser.add_argument("--predictions", default=str(PROJECT_ROOT / "predictions.csv"))
    args = parser.parse_args()
    results = validate_submission(args.test, args.predictions)
    for name, passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL'} | {name} | {detail}")
    print(f"Result: {'PASS' if all(ok for _, ok, _ in results) else 'FAIL'}")
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
