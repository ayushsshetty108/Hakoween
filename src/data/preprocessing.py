"""Input loading and schema checks for FLOODCAST."""
from __future__ import annotations

from pathlib import Path
import pandas as pd

TARGET = "discharge_cfs"
KEYS = ["station_id", "date"]
BASE_FEATURES = [
    "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
    "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct",
]
SUBMISSION_COLUMNS = ["station_id", "date", TARGET]


def load_inputs(input_dir: str | Path = "data/raw") -> tuple[pd.DataFrame, pd.DataFrame]:
    root = Path(input_dir)
    train_path, test_path = root / "train.csv", root / "test.csv"
    if not train_path.exists() or not test_path.exists():
        raise FileNotFoundError(
            f"Expected {train_path} and {test_path}. Add the event starter CSV files and rerun."
        )
    train = pd.read_csv(train_path, dtype={"station_id": "string"})
    test = pd.read_csv(test_path, dtype={"station_id": "string"})
    return validate_inputs(train, test)


def _normalize(frame: pd.DataFrame, name: str, target_required: bool) -> pd.DataFrame:
    frame = frame.copy()
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    required = set(KEYS + BASE_FEATURES + ([TARGET] if target_required else []))
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing required columns: {missing}")
    frame["station_id"] = frame["station_id"].astype("string").str.strip()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.normalize()
    if frame["station_id"].isna().any() or frame["station_id"].eq("").any():
        raise ValueError(f"{name} has blank station_id values")
    if frame["date"].isna().any():
        raise ValueError(f"{name} has invalid dates")
    dup = frame.duplicated(KEYS, keep=False)
    if dup.any():
        examples = frame.loc[dup, KEYS].head(5).to_dict("records")
        raise ValueError(f"{name} has duplicate (station_id, date) keys: {examples}")
    for col in BASE_FEATURES + ([TARGET] if target_required else []):
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame


def validate_inputs(train: pd.DataFrame, test: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = _normalize(train, "train.csv", True)
    test = _normalize(test, "test.csv", False)
    if TARGET in test.columns:
        raise ValueError("test.csv must not contain discharge_cfs; refusing to risk target leakage")
    overlap = train.merge(test[KEYS], on=KEYS, how="inner")
    if not overlap.empty:
        raise ValueError(f"train.csv and test.csv share station/date keys: {overlap[KEYS].head(5).to_dict('records')}")
    if train[TARGET].isna().any():
        raise ValueError("train.csv contains missing or non-numeric discharge_cfs values")
    if not train[TARGET].map(lambda x: pd.notna(x) and abs(x) != float("inf")).all():
        raise ValueError("train.csv discharge_cfs must be finite")
    if (train[TARGET] < 0).any():
        raise ValueError("train.csv discharge_cfs contains negative values")
    for name, frame in (("train.csv", train), ("test.csv", test)):
        area = frame["drainage_area_sqmi"]
        invalid = area.isna() | ~area.map(lambda value: pd.notna(value) and abs(value) != float("inf")) | area.le(0)
        if invalid.any():
            rows = frame.index[invalid].tolist()[:5]
            raise ValueError(
                f"{name} requires finite, strictly positive drainage_area_sqmi in square miles; "
                f"invalid row indices include {rows}. No fallback area is inferred."
            )
    # Keep test-only extra columns (for example lat/lon) for feature engineering,
    # but the model explicitly selects numeric/cyclic features below.
    return train, test


def data_quality_report(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    static = [c for c in BASE_FEATURES if c in train.columns and c.startswith(("drainage_", "mean_", "slope_", "forest_"))]
    consistency = {}
    for col in static:
        counts = train.groupby("station_id", dropna=False)[col].nunique(dropna=True)
        consistency[col] = {"stations_with_multiple_values": int((counts > 1).sum()),
                            "station_count": int(len(counts))}
    return {
        "train_rows": int(len(train)), "test_rows": int(len(test)),
        "train_stations": int(train.station_id.nunique()),
        "test_stations": int(test.station_id.nunique()),
        "unseen_test_stations": sorted(set(test.station_id) - set(train.station_id)),
        "train_date_range": [str(train.date.min().date()), str(train.date.max().date())],
        "test_date_range": [str(test.date.min().date()), str(test.date.max().date())],
        "missing_train_by_column": {k: int(v) for k, v in train.isna().sum().items()},
        "missing_test_by_column": {k: int(v) for k, v in test.isna().sum().items()},
        "missing_train_by_station": {
            str(station): {str(col): int(count) for col, count in frame.isna().sum().items() if count}
            for station, frame in train.groupby("station_id")
        },
        "static_attribute_consistency": consistency,
        "duplicate_train_keys": int(train.duplicated(KEYS).sum()),
        "duplicate_test_keys": int(test.duplicated(KEYS).sum()),
    }
