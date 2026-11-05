"""Build the isolated expanded set only from API response bodies already saved.

This offline finalizer never invents rows or measurements. Missing weather stays
missing, with its station IDs listed in the manifest.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from src.data.expand_station_dataset import ROOT, OUT, RAW, START, MIN_DAILY_ROWS, extract_daily


def weather_from_payload(payload, station):
    daily, hourly = payload.get("daily", {}), payload.get("hourly", {})
    h = pd.DataFrame({
        "time": pd.to_datetime(hourly.get("time", []), errors="coerce", utc=True),
        "soil07": pd.to_numeric(pd.Series(hourly.get("soil_moisture_0_to_7cm", [])), errors="coerce"),
        "soil728": pd.to_numeric(pd.Series(hourly.get("soil_moisture_7_to_28cm", [])), errors="coerce"),
    })
    h["date"] = h.time.dt.strftime("%Y-%m-%d")
    soils = h.groupby("date").agg(soil07=("soil07", "mean"), n07=("soil07", "count"),
                                   soil728=("soil728", "mean"), n728=("soil728", "count"))
    rows = []
    for i, date in enumerate(daily.get("time", [])):
        s = soils.loc[date] if date in soils.index else None
        rows.append({"station_id": station, "date": date,
                     "precipitation_mm": (daily.get("precipitation_sum") or [None])[i],
                     "temp_max_c": (daily.get("temperature_2m_max") or [None])[i],
                     "temp_min_c": (daily.get("temperature_2m_min") or [None])[i],
                     "temp_mean_c": (daily.get("temperature_2m_mean") or [None])[i],
                     "soil_moisture_0_7cm": float(s.soil07) if s is not None and s.n07 == 24 else np.nan,
                     "soil_moisture_7_28cm": float(s.soil728) if s is not None and s.n728 == 24 else np.nan})
    return rows


def main():
    raw = ROOT / "data" / "raw"
    old_train = pd.read_csv(raw / "train.csv", dtype={"station_id": "string"})
    old_test = pd.read_csv(raw / "test.csv", dtype={"station_id": "string"})
    old_static = pd.read_csv(raw / "station_metadata.csv", dtype={"station_id": "string"})
    for f in (old_train, old_test, old_static): f["station_id"] = f.station_id.astype("string").str.zfill(8)
    existing = set(old_train.station_id) | set(old_test.station_id)
    stations, q_parts, rejected = [], [], []
    for f in sorted((RAW / "usgs_responses").glob("daily_*.json")):
        sid = f.stem.removeprefix("daily_").zfill(8)
        if sid in existing: continue
        payload = json.loads(f.read_text(encoding="utf-8"))
        discharge = extract_daily(payload, sid)
        mf = RAW / "discovery" / f"metadata_{sid}.json"
        if not mf.exists(): continue
        feature = (json.loads(mf.read_text(encoding="utf-8")).get("features") or [None])[0]
        if not feature: continue
        p, coords = feature["properties"], feature["geometry"]["coordinates"]
        area = pd.to_numeric(pd.Series([p.get("drainage_area")]), errors="coerce").iloc[0]
        if len(discharge) < MIN_DAILY_ROWS or pd.isna(area) or area <= 0:
            rejected.append({"station_id": sid, "actual_records": len(discharge), "reason": "coverage below 2000 records or official drainage area unavailable"})
            continue
        stations.append({"station_id": sid, "station_name": p.get("monitoring_location_name"),
                         "state": p.get("state_name"), "state_code": p.get("state_code"),
                         "latitude": float(coords[1]), "longitude": float(coords[0]),
                         "huc": p.get("hydrologic_unit_code"), "drainage_area_sqmi": float(area),
                         "records": len(discharge), "date_start": discharge.date.min(), "date_end": discharge.date.max()})
        q_parts.append(discharge)
    if len(stations) != 20: raise RuntimeError(f"Expected 20 added stations in saved official responses, found {len(stations)}")

    weather_parts = []
    old_weather = pd.read_csv(raw / "openmeteo_weather.csv", dtype={"station_id": "string"})
    old_weather["station_id"] = old_weather.station_id.astype("string").str.zfill(8)
    weather_parts.append(old_weather)
    weather_ok, weather_unavailable = [], []
    for s in stations:
        path = RAW / "openmeteo_responses" / f"openmeteo_{s['station_id']}.json"
        if not path.exists():
            weather_unavailable.append(s["station_id"]); continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("error"): raise ValueError(payload.get("reason", "API error response"))
            rows = weather_from_payload(payload, s["station_id"])
            if not rows: raise ValueError("no daily weather rows in saved response")
            weather_parts.append(pd.DataFrame(rows)); weather_ok.append(s["station_id"])
        except Exception as exc:
            weather_unavailable.append(s["station_id"])
            rejected.append({"station_id": s["station_id"], "reason": f"Open-Meteo response unavailable: {exc}"})
    weather = pd.concat(weather_parts, ignore_index=True, sort=False)
    weather["station_id"] = weather.station_id.astype("string").str.zfill(8)
    weather["date"] = pd.to_datetime(weather.date).dt.strftime("%Y-%m-%d")
    weather = weather.drop_duplicates(["station_id", "date"])

    old_static = old_static[["station_id", "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]]
    new_static = pd.DataFrame(stations)[["station_id", "drainage_area_sqmi"]]
    for col in ("mean_elevation_ft", "slope_pct", "forest_cover_pct"): new_static[col] = np.nan
    static = pd.concat([old_static, new_static], ignore_index=True)
    weather = weather.merge(static, on="station_id", how="left", validate="many_to_one")
    weather["soil_moisture"] = weather["soil_moisture_0_7cm"]
    context_cols = ["station_id", "date", "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
                    "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]
    context = weather[[c for c in context_cols if c in weather.columns]].copy()
    q_old = pd.read_csv(raw / "usgs_discharge.csv", dtype={"station_id": "string"})
    q_old["station_id"] = q_old.station_id.astype("string").str.zfill(8)
    q = pd.concat([q_old, *q_parts], ignore_index=True).drop_duplicates(["station_id", "date"])
    train = q.merge(weather, on=["station_id", "date"], how="left", validate="one_to_one")
    train = train[["station_id", "date", "discharge_cfs", "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
                   "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]]
    OUT.mkdir(parents=True, exist_ok=True)
    train.to_csv(OUT / "train.csv", index=False, encoding="utf-8")
    old_test.to_csv(OUT / "test.csv", index=False, encoding="utf-8")
    context.to_csv(OUT / "feature_context.csv", index=False, encoding="utf-8")
    q.to_csv(OUT / "usgs_discharge.csv", index=False, encoding="utf-8")
    weather.to_csv(OUT / "openmeteo_weather.csv", index=False, encoding="utf-8")
    pd.DataFrame(stations).to_csv(OUT / "added_station_metadata.csv", index=False, encoding="utf-8")
    manifest = {"added_station_count": len(stations), "total_training_stations": int(train.station_id.nunique()),
                "training_rows": len(train), "added_discharge_rows": int(sum(len(x) for x in q_parts)),
                "stations": stations, "weather_success_station_ids": weather_ok,
                "weather_unavailable_station_ids": weather_unavailable,
                "weather_rows_saved": len(weather), "weather_missing_counts": {str(k): int(v) for k,v in weather.isna().sum().items()},
                "catchment_features_for_added_stations": "mean elevation, slope and forest cover remain missing; not inferred from station altitude",
                "rejected_candidates": rejected, "official_metric_weights": {"overall_rmse":0.40,"extreme_rmse":0.30,"mae":0.20,"r2":0.10},
                "expanded_station_cv_status": "not run; Open-Meteo returned HTTP 429 during station weather retrieval. Run after API limit resets; raw missing weather remains empty.",
                "production_model_modified": False, "predictions_csv_modified": False}
    (OUT / "station_expansion_manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"added_stations":len(stations),"added_discharge_rows":manifest['added_discharge_rows'],
                      "total_stations":manifest['total_training_stations'],"train_rows":len(train),
                      "weather_complete_stations":len(weather_ok)+5,"weather_unavailable_added_stations":len(weather_unavailable),
                      "training_weather_missing":{c:int(train[c].isna().sum()) for c in ['precipitation_mm','temp_max_c','temp_min_c','soil_moisture']}},indent=2))


if __name__ == "__main__": main()
