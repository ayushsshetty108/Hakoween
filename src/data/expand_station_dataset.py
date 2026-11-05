"""Discover 20 additional real USGS gages and build an isolated 24-station set.

Uses USGS daily mean discharge and monitoring-location metadata, plus Open-Meteo
ERA5 weather. It never downloads labels for the competition's held-out station.
All source responses and station selection failures are saved under
data/expanded_24_station/raw/.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "expanded_24_station"
RAW = OUT / "raw"
USGS = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"
OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive"
START, END, SAMPLE_DATE = "2010-01-01", "2018-12-31", "2018-12-31"
MIN_DAILY_ROWS = 2000  # Retain actual stations with >=61% coverage; never fill gaps
STATES = [
    ("23", "Maine"), ("25", "Massachusetts"), ("36", "New York"), ("42", "Pennsylvania"),
    ("51", "Virginia"), ("54", "West Virginia"), ("01", "Alabama"), ("13", "Georgia"),
    ("12", "Florida"), ("22", "Louisiana"), ("05", "Arkansas"), ("19", "Iowa"),
    ("55", "Wisconsin"), ("26", "Michigan"), ("27", "Minnesota"), ("08", "Colorado"),
    ("04", "Arizona"), ("35", "New Mexico"), ("49", "Utah"), ("41", "Oregon"),
    ("53", "Washington"), ("16", "Idaho"), ("30", "Montana"), ("56", "Wyoming"),
    ("32", "Nevada"),
]
LOG: list[dict] = []
FAILURES: list[dict] = []


def now():
    return datetime.now(timezone.utc).isoformat()


def get_json(url, params, tag, raw_path, timeout=90):
    RAW.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(1, 6):
        try:
            response = requests.get(url, params=params, timeout=timeout,
                                    headers={"User-Agent": "FLOODCAST-V2-real-station-expansion/1.0"})
            LOG.append({"time_utc": now(), "tag": tag, "url": response.url,
                        "status": response.status_code, "attempt": attempt,
                        "response_bytes": len(response.content)})
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(response.content)
            if response.ok:
                time.sleep(0.15)
                return response.json()
            last_error = f"HTTP {response.status_code}: {response.text[:1200]}"
            FAILURES.append({"time_utc": now(), "tag": tag, "url": response.url,
                             "status": response.status_code, "attempt": attempt,
                             "error": last_error})
            if response.status_code not in {408, 425, 429, 500, 502, 503, 504}:
                break
        except Exception as exc:
            last_error = repr(exc)
            FAILURES.append({"time_utc": now(), "tag": tag, "url": url,
                             "status": None, "attempt": attempt, "error": last_error})
        time.sleep(min(2 ** (attempt - 1), 16))
    raise RuntimeError(f"Request failed for {tag}: {last_error}")


def site_id(feature):
    loc = str(feature.get("properties", {}).get("monitoring_location_id", ""))
    return loc[5:].zfill(8) if loc.startswith("USGS-") else None


def extract_daily(payload, station):
    rows = []
    for feature in payload.get("features", []):
        p = feature.get("properties", {})
        if (p.get("monitoring_location_id") != f"USGS-{station}"
                or p.get("parameter_code") != "00060" or p.get("statistic_id") != "00003"):
            continue
        unit = str(p.get("unit_of_measure", "")).lower().replace(" ", "")
        if unit not in {"ft^3/s", "ft3/s", "cfs"}:
            continue
        value = pd.to_numeric(pd.Series([p.get("value")]), errors="coerce").iloc[0]
        if pd.notna(value) and np.isfinite(value) and float(value) >= 0:
            rows.append({"station_id": station, "date": p.get("time"), "discharge_cfs": float(value)})
    result = pd.DataFrame(rows, columns=["station_id", "date", "discharge_cfs"])
    if not result.empty:
        result["date"] = pd.to_datetime(result.date, errors="coerce").dt.strftime("%Y-%m-%d")
        result = result.dropna(subset=["date"]).drop_duplicates(["station_id", "date"])
    return result


def discover_station_pool(existing_ids):
    found = []
    discovery = RAW / "discovery"
    for state_code, state_name in STATES:
        try:
            sample = get_json(f"{USGS}/daily/items", {
                "f": "json", "limit": 10000, "datetime": SAMPLE_DATE,
                "parameter_code": "00060", "statistic_id": "00003",
                "agency_code": "USGS", "state_code": state_code,
            }, f"USGS daily discovery {state_name}", discovery / f"daily_{state_code}_{SAMPLE_DATE}.json")
        except Exception as exc:
            FAILURES.append({"tag": f"station discovery {state_name}", "error": str(exc)})
            continue
        candidates = sorted({sid for f in sample.get("features", [])
                             if (sid := site_id(f)) and sid not in existing_ids})
        accepted = None
        for sid in candidates[:40]:
            try:
                md = get_json(f"{USGS}/monitoring-locations/items", {
                    "f": "json", "limit": 1, "id": f"USGS-{sid}",
                }, f"USGS station metadata {sid}", discovery / f"metadata_{sid}.json")
                feature = (md.get("features") or [None])[0]
                if not feature:
                    continue
                p = feature.get("properties", {})
                coords = feature.get("geometry", {}).get("coordinates", [])
                area = pd.to_numeric(pd.Series([p.get("drainage_area")]), errors="coerce").iloc[0]
                if (p.get("monitoring_location_number") != sid or p.get("state_code") != state_code
                        or p.get("site_type_code") != "ST" or pd.isna(area) or float(area) <= 0
                        or len(coords) < 2):
                    continue
                daily = get_json(f"{USGS}/daily/items", {
                    "f": "json", "limit": 10000,
                    "monitoring_location_id": f"USGS-{sid}", "parameter_code": "00060",
                    "statistic_id": "00003", "datetime": f"{START}/{END}",
                }, f"USGS daily discharge {sid}", RAW / "usgs_responses" / f"daily_{sid}.json")
                observations = extract_daily(daily, sid)
                if len(observations) < MIN_DAILY_ROWS:
                    FAILURES.append({"tag": f"coverage screen {sid}", "records": len(observations),
                                     "required": MIN_DAILY_ROWS, "result": "candidate rejected; no values fabricated"})
                    continue
                accepted = {
                    "station_id": sid, "station_name": p.get("monitoring_location_name"),
                    "state": state_name, "state_code": state_code,
                    "latitude": float(coords[1]), "longitude": float(coords[0]),
                    "huc": p.get("hydrologic_unit_code"), "drainage_area_sqmi": float(area),
                    "contributing_drainage_area_sqmi": p.get("contributing_drainage_area"),
                    "usgs_altitude_ft": p.get("altitude"), "records": int(len(observations)),
                    "date_start": observations.date.min(), "date_end": observations.date.max(),
                    "discharge": observations,
                }
                break
            except Exception as exc:
                FAILURES.append({"tag": f"candidate {sid}", "state": state_name, "error": str(exc)})
        if accepted:
            found.append(accepted)
            print(f"Selected {accepted['station_id']} {state_name}: {accepted['records']} USGS days")
        if len(found) >= 20:
            break
    if len(found) != 20:
        raise RuntimeError(f"Only {len(found)} additional stations passed the live API and coverage checks; need 20. See {RAW / 'acquisition_failures.json'}")
    return found


def fetch_weather(stations):
    out = []
    for s in stations:
        params = {
            "latitude": s["latitude"], "longitude": s["longitude"],
            "start_date": START, "end_date": "2019-12-31",
            "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean",
            "hourly": "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm",
            "timezone": "UTC", "models": "era5",
        }
        payload = get_json(OPEN_METEO, params, f"Open-Meteo ERA5 {s['station_id']}",
                           RAW / "openmeteo_responses" / f"openmeteo_{s['station_id']}.json")
        print(f"Downloaded Open-Meteo weather for {s['station_id']} ({s['state']})", flush=True)
        daily = payload.get("daily", {})
        hourly = payload.get("hourly", {})
        h = pd.DataFrame({
            "time": pd.to_datetime(hourly.get("time", []), errors="coerce", utc=True),
            "soil_0_7": pd.to_numeric(pd.Series(hourly.get("soil_moisture_0_to_7cm", [])), errors="coerce"),
            "soil_7_28": pd.to_numeric(pd.Series(hourly.get("soil_moisture_7_to_28cm", [])), errors="coerce"),
        })
        h["date"] = h.time.dt.strftime("%Y-%m-%d")
        daily_soil = h.groupby("date").agg(
            soil_moisture_0_7cm=("soil_0_7", "mean"), soil_0_7_hours=("soil_0_7", "count"),
            soil_moisture_7_28cm=("soil_7_28", "mean"), soil_7_28_hours=("soil_7_28", "count"))
        for i, date in enumerate(daily.get("time", [])):
            soil = daily_soil.loc[date] if date in daily_soil.index else None
            out.append({
                "station_id": s["station_id"], "date": date,
                "precipitation_mm": (daily.get("precipitation_sum") or [None])[i],
                "temp_max_c": (daily.get("temperature_2m_max") or [None])[i],
                "temp_min_c": (daily.get("temperature_2m_min") or [None])[i],
                "temp_mean_c": (daily.get("temperature_2m_mean") or [None])[i],
                "soil_moisture_0_7cm": float(soil.soil_moisture_0_7cm) if soil is not None and soil.soil_0_7_hours == 24 else np.nan,
                "soil_moisture_7_28cm": float(soil.soil_moisture_7_28cm) if soil is not None and soil.soil_7_28_hours == 24 else np.nan,
            })
    return pd.DataFrame(out)


def build_expanded(stations):
    original_raw = ROOT / "data" / "raw"
    original_train = pd.read_csv(original_raw / "train.csv", dtype={"station_id": "string"})
    original_test = pd.read_csv(original_raw / "test.csv", dtype={"station_id": "string"})
    original_context = pd.read_csv(original_raw / "feature_context.csv", dtype={"station_id": "string"})
    original_metadata = pd.read_csv(original_raw / "station_metadata.csv", dtype={"station_id": "string"})
    for frame in (original_train, original_test, original_context, original_metadata):
        frame["station_id"] = frame.station_id.astype("string").str.zfill(8)
    original_train["date"] = pd.to_datetime(original_train.date).dt.strftime("%Y-%m-%d")
    original_test["date"] = pd.to_datetime(original_test.date).dt.strftime("%Y-%m-%d")
    original_context["date"] = pd.to_datetime(original_context.date).dt.strftime("%Y-%m-%d")

    new_q = pd.concat([s["discharge"] for s in stations], ignore_index=True)
    q_old = pd.read_csv(original_raw / "usgs_discharge.csv", dtype={"station_id": "string"})
    q_old["station_id"] = q_old.station_id.astype("string").str.zfill(8)
    q = pd.concat([q_old, new_q], ignore_index=True).drop_duplicates(["station_id", "date"])
    new_weather = fetch_weather(stations)
    old_weather = pd.read_csv(original_raw / "openmeteo_weather.csv", dtype={"station_id": "string"})
    old_weather["station_id"] = old_weather.station_id.astype("string").str.zfill(8)
    weather = pd.concat([old_weather, new_weather], ignore_index=True)
    weather["station_id"] = weather.station_id.astype("string").str.zfill(8)
    weather["date"] = pd.to_datetime(weather.date).dt.strftime("%Y-%m-%d")
    if weather.duplicated(["station_id", "date"]).any():
        raise ValueError("Expanded weather has duplicate station-date records")

    # Reuse existing station attributes for the original five project stations.
    old_static = original_metadata[["station_id", "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]]
    new_meta = pd.DataFrame([{k: s.get(k) for k in ["station_id", "station_name", "state", "state_code", "latitude", "longitude", "huc", "drainage_area_sqmi", "contributing_drainage_area_sqmi", "usgs_altitude_ft", "records", "date_start", "date_end"]} for s in stations])
    new_static = new_meta[["station_id", "drainage_area_sqmi"]].copy()
    for col in ("mean_elevation_ft", "slope_pct", "forest_cover_pct"):
        new_static[col] = np.nan  # no basin value is invented or substituted
    static = pd.concat([old_static, new_static], ignore_index=True)
    weather = weather.merge(static, on="station_id", how="left", validate="many_to_one")
    weather["soil_moisture"] = weather["soil_moisture_0_7cm"]
    context_cols = ["station_id", "date", "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
                    "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]
    context = weather[context_cols].copy()
    q["station_id"] = q.station_id.astype("string").str.zfill(8)
    q["date"] = pd.to_datetime(q.date).dt.strftime("%Y-%m-%d")
    train = q.merge(weather, on=["station_id", "date"], how="inner", validate="one_to_one")
    train = train[["station_id", "date", "discharge_cfs", "precipitation_mm", "temp_max_c", "temp_min_c",
                   "soil_moisture", "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]]
    test = original_test.copy()
    # Inputs are isolated; the competition test file and production inputs are untouched.
    OUT.mkdir(parents=True, exist_ok=True)
    train.to_csv(OUT / "train.csv", index=False, encoding="utf-8")
    test.to_csv(OUT / "test.csv", index=False, encoding="utf-8")
    context.to_csv(OUT / "feature_context.csv", index=False, encoding="utf-8")
    q.to_csv(OUT / "usgs_discharge.csv", index=False, encoding="utf-8")
    weather.to_csv(OUT / "openmeteo_weather.csv", index=False, encoding="utf-8")
    new_meta.to_csv(OUT / "added_station_metadata.csv", index=False, encoding="utf-8")
    manifest = {
        "created_at_utc": now(), "source": "USGS Water Data API v1 OGC daily and monitoring-locations; Open-Meteo Historical Archive ERA5",
        "station_selection": f"One additional USGS stream gage per state, discovered from actual 00060/00003 data on {SAMPLE_DATE}; each retained only with positive official drainage area and at least {MIN_DAILY_ROWS} actual daily records in {START}..{END}.",
        "existing_training_stations": sorted(original_train.station_id.unique().tolist()),
        "added_stations": new_meta.to_dict("records"),
        "unique_training_stations": int(train.station_id.nunique()), "training_rows": int(len(train)),
        "actual_discharge_rows_by_station": {str(k): int(v) for k,v in train.groupby("station_id").size().items()},
        "weather_rows": int(len(weather)), "weather_missing_counts": {str(k): int(v) for k,v in weather.isna().sum().items()},
        "static_feature_missing_counts": {c: int(train[c].isna().sum()) for c in ["mean_elevation_ft","slope_pct","forest_cover_pct"]},
        "test_labels_requested": False, "test_input_modified": False, "production_model_modified": False,
        "predictions_csv_modified": False, "requests": LOG, "failures_and_rejected_candidates": FAILURES,
    }
    (OUT / "station_expansion_manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    (RAW / "acquisition_failures.json").write_text(json.dumps(FAILURES, indent=2), encoding="utf-8")
    return manifest


def main():
    original = pd.read_csv(ROOT / "data" / "raw" / "train.csv", dtype={"station_id": "string"})
    test = pd.read_csv(ROOT / "data" / "raw" / "test.csv", dtype={"station_id": "string"})
    existing = set(original.station_id.astype(str).str.zfill(8)) | set(test.station_id.astype(str).str.zfill(8))
    selected = discover_station_pool(existing)
    manifest = build_expanded(selected)
    print(json.dumps({k: manifest[k] for k in ["unique_training_stations", "training_rows", "weather_rows", "weather_missing_counts", "static_feature_missing_counts", "added_stations"]}, indent=2, default=str))


if __name__ == "__main__":
    main()
