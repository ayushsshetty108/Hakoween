"""Acquire FLOODCAST data from USGS, Open-Meteo, and current StreamStats APIs.

The script uses train.csv/test.csv only for station IDs and date coverage. It
never requests or writes discharge observations for the test station. Raw API
response bodies are retained separately from cleaned CSV outputs.
"""
from __future__ import annotations

import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
TRAIN_FILE = RAW / "train.csv"
TEST_FILE = RAW / "test.csv"
STATION_FILE = RAW / "station_metadata.csv"
USER_AGENT = "FLOODCAST-V2-data-acquisition/1.0"
MAX_ATTEMPTS = 5
RETRY_BASE_SECONDS = 1.0
RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504}
REQUEST_LOG: list[dict[str, Any]] = []
FAILURES: list[dict[str, Any]] = []

USGS_BASE = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"
OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"
SS_DELINEATE = "https://streamstats.usgs.gov/ss-delineate/v1/delineate/sshydro"
SS_HYDRO = "https://streamstats.usgs.gov/ss-hydro/v1/basin-characteristics/calculate"

STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY", "Puerto Rico": "PR",
}


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_failure(source: str, station_id: str | None, url: str, status: int | None,
                   body: str, attempt: int, error: str | None = None) -> None:
    FAILURES.append({
        "retrieved_at_utc": now_utc(), "source": source, "station_id": station_id,
        "url": url, "http_status": status, "attempt": attempt,
        "error": error, "response_excerpt": body[:4000],
    })


def request_with_retry(method: str, url: str, *, source: str, station_id: str | None = None,
                       params: dict[str, Any] | None = None,
                       json_body: Any = None) -> requests.Response | None:
    session = requests.Session()
    headers = {"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json"}
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started = time.monotonic()
        try:
            response = session.request(method, url, params=params, json=json_body,
                                       headers=headers, timeout=(15, 120))
            entry = {
                "retrieved_at_utc": now_utc(), "source": source, "station_id": station_id,
                "method": method, "url": response.url, "http_status": response.status_code,
                "attempt": attempt, "response_bytes": len(response.content),
                "elapsed_seconds": round(time.monotonic() - started, 3),
            }
            REQUEST_LOG.append(entry)
            if response.ok:
                time.sleep(0.2)
                return response
            body = response.text or ""
            record_failure(source, station_id, response.url, response.status_code, body, attempt)
            if response.status_code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                return response
        except requests.RequestException as exc:
            REQUEST_LOG.append({
                "retrieved_at_utc": now_utc(), "source": source, "station_id": station_id,
                "method": method, "url": url, "http_status": None, "attempt": attempt,
                "elapsed_seconds": round(time.monotonic() - started, 3), "exception": str(exc),
            })
            record_failure(source, station_id, url, None, "", attempt, error=str(exc))
            if attempt == MAX_ATTEMPTS:
                return None
        time.sleep(RETRY_BASE_SECONDS * (2 ** (attempt - 1)))
    return None


def save_response(path: Path, response: requests.Response | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if response is None:
        return
    path.write_bytes(response.content)


def parse_input_keys() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, str, str]:
    for path in (TRAIN_FILE, TEST_FILE, STATION_FILE):
        if not path.is_file():
            raise FileNotFoundError(f"Required existing project input not found: {path}")
    train = pd.read_csv(TRAIN_FILE, dtype={"station_id": "string"})
    test = pd.read_csv(TEST_FILE, dtype={"station_id": "string"})
    metadata = pd.read_csv(STATION_FILE, dtype={"station_id": "string"})
    for frame, label in ((train, "train.csv"), (test, "test.csv")):
        if not {"station_id", "date"}.issubset(frame.columns):
            raise ValueError(f"{label} must include station_id and date")
        frame["station_id"] = frame["station_id"].str.strip().str.zfill(8)
        frame["date"] = pd.to_datetime(frame["date"], errors="raise").dt.normalize()
        if frame.duplicated(["station_id", "date"]).any():
            raise ValueError(f"{label} contains duplicate station-date keys")
    if "discharge_cfs" in test.columns:
        raise ValueError("test.csv contains a target column; acquisition will not use it")
    train_stations = set(train.station_id.dropna().astype(str))
    test_stations = set(test.station_id.dropna().astype(str))
    if train_stations & test_stations:
        # Station overlap can be valid for time-split competitions, but discharge
        # queries still use only training station IDs and dates.
        pass
    all_ids = sorted(train_stations | test_stations)
    if set(metadata.station_id.astype(str)) != set(all_ids):
        raise ValueError("station_metadata.csv IDs do not exactly match train/test station IDs")
    start = min(train.date.min(), test.date.min()).date().isoformat()
    end = max(train.date.max(), test.date.max()).date().isoformat()
    return train, test, metadata, start, end


def get_station_metadata(station_ids: list[str]) -> tuple[pd.DataFrame, dict[str, Any]]:
    rows, raw_cache = [], {}
    for station_id in station_ids:
        url = f"{USGS_BASE}/monitoring-locations/items"
        response = request_with_retry("GET", url, source="USGS monitoring locations",
                                      station_id=station_id,
                                      params={"f": "json", "limit": 1, "id": f"USGS-{station_id}"})
        raw_path = RAW / "usgs_responses" / f"station_metadata_{station_id}.json"
        save_response(raw_path, response)
        if response is None or not response.ok:
            rows.append({"station_id": station_id, "metadata_status": "failed"})
            continue
        try:
            payload = response.json()
            feature = payload["features"][0]
            props, coords = feature["properties"], feature["geometry"]["coordinates"]
            if str(props.get("monitoring_location_number")) != station_id:
                raise ValueError("USGS station ID does not match requested ID")
            rows.append({
                "station_id": station_id,
                "station_name": props.get("monitoring_location_name"),
                "latitude": coords[1], "longitude": coords[0],
                "state": props.get("state_name"), "state_code": props.get("state_code"),
                "county": props.get("county_name"), "huc": props.get("hydrologic_unit_code"),
                "drainage_area_sqmi": props.get("drainage_area"),
                "contributing_drainage_area_sqmi": props.get("contributing_drainage_area"),
                "usgs_altitude_m": props.get("altitude"),
                "usgs_altitude_unit": "m" if props.get("altitude") is not None else None,
                "metadata_status": "success",
            })
            raw_cache[station_id] = payload
        except (ValueError, TypeError, KeyError, IndexError) as exc:
            record_failure("USGS monitoring locations parse", station_id, response.url,
                           response.status_code, response.text, 1, error=str(exc))
            rows.append({"station_id": station_id, "metadata_status": f"parse_failed: {exc}"})
    df = pd.DataFrame(rows)
    df.to_csv(RAW / "usgs_station_metadata.csv", index=False, encoding="utf-8")
    return df, raw_cache


def fetch_usgs_discharge(train_df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    records, station_status = [], {}
    for station_id, group in train_df.groupby("station_id", sort=True):
        start = group.date.min().date().isoformat()
        end = group.date.max().date().isoformat()
        station_records, page = [], 0
        url = f"{USGS_BASE}/daily/items"
        params: dict[str, Any] | None = {
            "f": "json", "limit": 10000, "monitoring_location_id": f"USGS-{station_id}",
            "parameter_code": "00060", "statistic_id": "00003", "datetime": f"{start}/{end}",
        }
        while url:
            response = request_with_retry("GET", url, source="USGS daily discharge",
                                          station_id=str(station_id), params=params)
            page += 1
            raw_path = RAW / "usgs_responses" / f"daily_{station_id}_page_{page:03d}.json"
            save_response(raw_path, response)
            if response is None or not response.ok:
                station_status[str(station_id)] = {"status": "failed", "rows": len(station_records),
                                                   "date_start": start, "date_end": end, "pages": page}
                url = ""
                break
            try:
                payload = response.json()
            except ValueError as exc:
                record_failure("USGS daily discharge parse", str(station_id), response.url,
                               response.status_code, response.text, 1, error=str(exc))
                station_status[str(station_id)] = {"status": "invalid_json", "rows": len(station_records),
                                                   "date_start": start, "date_end": end, "pages": page}
                url = ""
                break
            for item in payload.get("features", []):
                props = item.get("properties", {})
                if (props.get("monitoring_location_id") != f"USGS-{station_id}" or
                    props.get("parameter_code") != "00060" or props.get("statistic_id") != "00003"):
                    record_failure("USGS daily discharge unexpected response row", str(station_id),
                                   response.url, response.status_code, json.dumps(props), 1,
                                   error="Station, parameter, or statistic did not match request")
                    continue
                unit = str(props.get("unit_of_measure", ""))
                value = pd.to_numeric(pd.Series([props.get("value")]), errors="coerce").iloc[0]
                if unit.lower().replace(" ", "") not in {"ft^3/s", "ft3/s", "cfs"}:
                    record_failure("USGS discharge unit", str(station_id), response.url,
                                   response.status_code, json.dumps(props), 1,
                                   error=f"Unexpected discharge unit: {unit}")
                    value = np.nan
                station_records.append({"station_id": str(station_id), "date": props.get("time"),
                                        "discharge_cfs": value})
            next_link = next((x.get("href") for x in payload.get("links", []) if x.get("rel") == "next"), None)
            url, params = next_link, None
        records.extend(station_records)
        if str(station_id) not in station_status:
            station_status[str(station_id)] = {"status": "success", "rows": len(station_records),
                                               "date_start": start, "date_end": end, "pages": page}
    df = pd.DataFrame(records, columns=["station_id", "date", "discharge_cfs"])
    if not df.empty:
        df["station_id"] = df.station_id.astype("string").str.zfill(8)
        df["date"] = pd.to_datetime(df.date, errors="coerce").dt.strftime("%Y-%m-%d")
        df["discharge_cfs"] = pd.to_numeric(df.discharge_cfs, errors="coerce")
        df = df.sort_values(["station_id", "date"], kind="stable").reset_index(drop=True)
        if df.duplicated(["station_id", "date"]).any():
            record_failure("USGS daily discharge duplicate keys", None, "", None, "", 1,
                           error="Duplicate station-date observations in downloaded records")
    df.to_csv(RAW / "usgs_discharge.csv", index=False, encoding="utf-8")
    return df, station_status


def fetch_openmeteo_weather(metadata: pd.DataFrame, start: str, end: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    weather_rows, station_status = [], {}
    for row in metadata.itertuples(index=False):
        station_id = str(row.station_id)
        if getattr(row, "metadata_status", "") != "success":
            station_status[station_id] = {"status": "skipped_no_usgs_metadata", "rows": 0}
            continue
        params = {
            "latitude": float(row.latitude), "longitude": float(row.longitude),
            "start_date": start, "end_date": end,
            "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean",
            "hourly": "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm",
            "timezone": "UTC", "models": "era5",
        }
        response = request_with_retry("GET", OPEN_METEO_URL, source="Open-Meteo Historical Archive",
                                      station_id=station_id, params=params)
        save_response(RAW / "openmeteo_responses" / f"openmeteo_{station_id}.json", response)
        if response is None or not response.ok:
            station_status[station_id] = {"status": "failed", "rows": 0, "date_start": start, "date_end": end}
            continue
        try:
            payload = response.json()
            daily = payload.get("daily", {})
            hourly = payload.get("hourly", {})
            soil_values = pd.DataFrame({
                "time": pd.to_datetime(hourly.get("time", []), errors="coerce", utc=True),
                "soil": pd.to_numeric(pd.Series(hourly.get("soil_moisture_0_to_7cm", [])), errors="coerce"),
                "soil_7_28": pd.to_numeric(pd.Series(hourly.get("soil_moisture_7_to_28cm", [])), errors="coerce"),
            })
            soil_values["date"] = soil_values.time.dt.strftime("%Y-%m-%d")
            daily_soil = soil_values.groupby("date", dropna=False).agg(
                soil_moisture_0_7cm=("soil", "mean"), soil_hours=("soil", "count"),
                soil_moisture_7_28cm=("soil_7_28", "mean"), soil_7_28_hours=("soil_7_28", "count"))
            daily_dates = daily.get("time", [])
            for i, date in enumerate(daily_dates):
                soil = daily_soil.loc[date] if date in daily_soil.index else None
                # A daily soil value is emitted only when the source has all 24
                # hourly values. Missing hours remain missing, never imputed.
                soil_day = float(soil.soil_moisture_0_7cm) if soil is not None and int(soil.soil_hours) == 24 else np.nan
                soil_day_7_28 = float(soil.soil_moisture_7_28cm) if soil is not None and int(soil.soil_7_28_hours) == 24 else np.nan
                weather_rows.append({
                    "station_id": station_id, "date": date,
                    "precipitation_mm": daily.get("precipitation_sum", [None] * len(daily_dates))[i],
                    "temp_max_c": daily.get("temperature_2m_max", [None] * len(daily_dates))[i],
                    "temp_min_c": daily.get("temperature_2m_min", [None] * len(daily_dates))[i],
                    "temp_mean_c": daily.get("temperature_2m_mean", [None] * len(daily_dates))[i],
                    "soil_moisture_0_7cm": soil_day,
                    "soil_moisture_7_28cm": soil_day_7_28,
                })
            station_status[station_id] = {
                "status": "success", "rows": len(daily_dates), "date_start": daily_dates[0] if daily_dates else None,
                "date_end": daily_dates[-1] if daily_dates else None,
                "requested_coordinates": [float(row.latitude), float(row.longitude)],
                "weather_grid_coordinates": [payload.get("latitude"), payload.get("longitude")],
                "model": "ERA5", "timezone": payload.get("timezone"),
                "soil_hours_missing_or_incomplete": int(daily_soil.soil_hours.ne(24).sum()) if len(daily_soil) else len(daily_dates),
                "soil_7_28_hours_missing_or_incomplete": int(daily_soil.soil_7_28_hours.ne(24).sum()) if len(daily_soil) else len(daily_dates),
            }
        except (ValueError, TypeError, KeyError, IndexError) as exc:
            record_failure("Open-Meteo parse", station_id, response.url, response.status_code,
                           response.text, 1, error=str(exc))
            station_status[station_id] = {"status": f"parse_failed: {exc}", "rows": 0}
    df = pd.DataFrame(weather_rows, columns=[
        "station_id", "date", "precipitation_mm", "temp_max_c", "temp_min_c",
        "temp_mean_c", "soil_moisture_0_7cm", "soil_moisture_7_28cm",
    ])
    if not df.empty:
        df["station_id"] = df.station_id.astype("string").str.zfill(8)
        df = df.sort_values(["station_id", "date"], kind="stable").reset_index(drop=True)
        if df.duplicated(["station_id", "date"]).any():
            record_failure("Open-Meteo duplicate keys", None, OPEN_METEO_URL, None, "", 1,
                           error="Duplicate station-date observations in downloaded weather")
    df.to_csv(RAW / "openmeteo_weather.csv", index=False, encoding="utf-8")
    return df, station_status


def walk_named_features(node: Any):
    if isinstance(node, dict):
        if "name" in node and "feature" in node:
            yield node
        for value in node.values():
            yield from walk_named_features(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_named_features(value)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        crosses = ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi)
        if crosses:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon: float, lat: float, geometry: dict[str, Any] | None) -> bool:
    if not geometry:
        return False
    kind, coords = geometry.get("type"), geometry.get("coordinates", [])
    polygons = [coords] if kind == "Polygon" else coords if kind == "MultiPolygon" else []
    for polygon in polygons:
        if polygon and point_in_ring(lon, lat, polygon[0]):
            if not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
                return True
    return False


def numeric_value(features: list[dict[str, Any]], codes: list[str], *,
                  reject_point_extract: bool = False) -> tuple[float, str | None, str | None]:
    by_code = {str(item.get("code", "")).upper(): item for item in features}
    for code in codes:
        item = by_code.get(code.upper())
        if item is None:
            continue
        if reject_point_extract and "pointextract" in str(item.get("msg", "")).replace(" ", "").lower():
            continue
        val = pd.to_numeric(pd.Series([item.get("value")]), errors="coerce").iloc[0]
        if pd.notna(val) and np.isfinite(float(val)) and float(val) > -900:
            return float(val), str(item.get("unit", "")), code
    return np.nan, None, None


def fetch_streamstats(metadata: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    result_rows, station_status = [], {}
    for row in metadata.itertuples(index=False):
        station_id = str(row.station_id)
        base = {
            "station_id": station_id, "drainage_area_sqmi": np.nan,
            "mean_basin_elevation_m": np.nan, "slope_pct": np.nan,
            "forest_cover_pct": np.nan, "impervious_surface_pct": np.nan,
        "mean_basin_elevation_source_code": None, "slope_source_code": None,
        "forest_source_code": None, "impervious_source_code": None,
        }
        reasons = {key: "not retrieved" for key in (
            "drainage_area_sqmi", "mean_basin_elevation_m", "slope_pct",
            "forest_cover_pct", "impervious_surface_pct",
        )}
        if getattr(row, "metadata_status", "") != "success":
            status = "failed: USGS station metadata unavailable"
            result_rows.append({**base, "delineation_verified": False,
                                "delineation_status": status,
                                **{f"{k}_missing_reason": v for k, v in reasons.items()}})
            station_status[station_id] = {"status": status}
            continue
        state_name = str(row.state)
        region = STATE_ABBR.get(state_name)
        if not region:
            status = f"failed: no StreamStats region mapping for USGS state {state_name}"
            record_failure("StreamStats region lookup", station_id, SS_DELINEATE, None, "", 1, error=status)
            result_rows.append({**base, "delineation_verified": False,
                                "delineation_status": status,
                                **{f"{k}_missing_reason": v for k, v in reasons.items()}})
            station_status[station_id] = {"status": status}
            continue
        delineate_url = f"{SS_DELINEATE}/{region}"
        resp = request_with_retry("GET", delineate_url, source="USGS SS-Delineate",
                                  station_id=station_id,
                                  params={"lat": float(row.latitude), "lon": float(row.longitude)})
        save_response(RAW / "streamstats_responses" / f"delineation_{station_id}.json", resp)
        if resp is None or not resp.ok:
            status = "failed: SS-Delineate request failed"
            result_rows.append({**base, "delineation_verified": False,
                                "delineation_status": status,
                                **{f"{k}_missing_reason": status for k in reasons}})
            station_status[station_id] = {"status": status}
            continue
        try:
            delineation = resp.json()
        except ValueError as exc:
            status = f"failed: invalid SS-Delineate JSON: {exc}"
            record_failure("SS-Delineate parse", station_id, resp.url, resp.status_code,
                           resp.text, 1, error=str(exc))
            result_rows.append({**base, "delineation_verified": False,
                                "delineation_status": status,
                                **{f"{k}_missing_reason": status for k in reasons}})
            station_status[station_id] = {"status": status}
            continue

        named = list(walk_named_features(delineation))
        watershed = next((item.get("feature") for item in named
                          if str(item.get("name", "")).lower() == "globalwatershed"), None)
        point_fc = next((item.get("feature") for item in named
                         if str(item.get("name", "")).lower() == "globalwatershedpoint"), None)
        watershed_features = watershed.get("features", []) if isinstance(watershed, dict) else []
        watershed_feature = next((f for f in watershed_features
                                  if str(f.get("properties", {}).get("GlobalWshd", f.get("properties", {}).get("globalWshd", ""))) == "1"),
                                 watershed_features[0] if watershed_features else None)
        point_features = point_fc.get("features", []) if isinstance(point_fc, dict) else []
        point_feature = point_features[0] if point_features else None
        prop_w = (watershed_feature or {}).get("properties", {})
        prop_p = (point_feature or {}).get("properties", {})
        warning = " ".join(str(x) for x in [prop_w.get("WarningMsg", ""), prop_p.get("WarningMsg", "")]).strip(" ,")
        point_coords = ((point_feature or {}).get("geometry") or {}).get("coordinates", [])
        huc_result = str(prop_p.get("HUCID", ""))
        huc_source = str(row.huc or "")
        huc_comparable = huc_result.isdigit() and huc_source.isdigit()
        huc_matches = bool(huc_comparable and huc_source.startswith(huc_result)) if huc_comparable else None
        input_inside = point_in_polygon(float(row.longitude), float(row.latitude),
                                        (watershed_feature or {}).get("geometry"))
        snapped_distance = (haversine_m(float(row.latitude), float(row.longitude),
                                       float(point_coords[1]), float(point_coords[0]))
                           if len(point_coords) >= 2 else float("inf"))
        bad_snap = "not snappable" in warning.lower()

        # Call current SS-Hydro even when delineation warnings are present so
        # the returned service response is recorded and its usable fields can
        # be assessed. Results are withheld unless the watershed verifies.
        hydro = request_with_retry("POST", SS_HYDRO, source="USGS SS-Hydro",
                                   station_id=station_id, json_body=delineation)
        save_response(RAW / "streamstats_responses" / f"hydro_{station_id}.json", hydro)
        hydro_features: list[dict[str, Any]] = []
        hydro_error = None
        if hydro is None or not hydro.ok:
            hydro_error = "SS-Hydro request failed"
        else:
            try:
                h = hydro.json()
                hydro_features = h if isinstance(h, list) else h.get("features", [])
            except ValueError as exc:
                hydro_error = f"invalid SS-Hydro JSON: {exc}"
                record_failure("SS-Hydro parse", station_id, hydro.url, hydro.status_code,
                               hydro.text, 1, error=str(exc))

        verified = bool(watershed_feature and not bad_snap and input_inside and snapped_distance <= 100.0
                        and huc_matches is not False and not hydro_error)
        verification_reasons = []
        if not watershed_feature:
            verification_reasons.append("SS-Delineate did not return a global watershed feature")
        if bad_snap:
            verification_reasons.append(f"SS-Delineate warning: {warning}")
        if not input_inside:
            verification_reasons.append("USGS station coordinate is not inside returned watershed polygon")
        if huc_matches is False:
            verification_reasons.append(f"Returned HUC {huc_result or 'missing'} does not match USGS HUC {huc_source or 'missing'}")
        elif huc_matches is None:
            # Some states return a regional watershed-unit identifier instead
            # of a HUC. In that case verify the outlet geometry and drainage
            # area against the official USGS station metadata below.
            station_status_huc_note = f"Returned watershed identifier {huc_result or 'missing'} is not an HUC; will verify by geometry and area"
        else:
            station_status_huc_note = "Returned HUC matches the USGS station HUC prefix"
        if snapped_distance > 100.0:
            verification_reasons.append(f"Returned pour point is {snapped_distance:.1f} m from the USGS station coordinate")
        if hydro_error:
            verification_reasons.append(hydro_error)

        # Keep the raw SS-Hydro response but only publish characteristics when
        # the delineation and station mapping pass the checks above.
        area = np.nan
        area_unit = None
        if not hydro_error:
            area, area_unit, _ = numeric_value(hydro_features, ["DRNAREA"])
            if pd.notna(area) and area_unit and "square mile" not in area_unit.lower() and "mi" not in area_unit.lower():
                verification_reasons.append(f"Unexpected SS-Hydro drainage-area unit: {area_unit}")
                area = np.nan
            if pd.notna(area) and pd.notna(row.drainage_area_sqmi) and float(row.drainage_area_sqmi) > 0:
                ratio = float(area) / float(row.drainage_area_sqmi)
                if not 0.8 <= ratio <= 1.2:
                    verification_reasons.append(
                        f"SS-Hydro drainage area {area:g} mi2 differs from USGS station metadata "
                        f"{float(row.drainage_area_sqmi):g} mi2 by more than 20%"
                    )
            elif pd.isna(area):
                verification_reasons.append("SS-Hydro did not return a valid drainage area for station verification")
            verified = verified and not verification_reasons
        if verified:
            elevation, elev_unit, elev_code = numeric_value(hydro_features, ["ELEV"], reject_point_extract=True)
            slope, slope_unit, slope_code = numeric_value(hydro_features,
                ["BSLDEM10M", "BSLDEM30M", "BSLDEM30FT", "BSLDEM10FF"], reject_point_extract=True)
            forest, forest_unit, forest_code = numeric_value(hydro_features, ["FOREST"], reject_point_extract=True)
            impervious, imperv_unit, imperv_code = numeric_value(
                hydro_features, ["IMPERV", "LC11IMP"], reject_point_extract=True)
            if pd.notna(area):
                base["drainage_area_sqmi"] = area
                reasons["drainage_area_sqmi"] = ""
            if pd.notna(elevation):
                base["mean_basin_elevation_m"] = elevation * 0.3048 if elev_unit and "ft" in elev_unit.lower() else elevation
                base["mean_basin_elevation_source_code"] = elev_code
                reasons["mean_basin_elevation_m"] = ""
            if pd.notna(slope):
                base["slope_pct"] = slope * 100.0 if slope_unit and "foot per foot" in slope_unit.lower() else slope
                base["slope_source_code"] = slope_code
                reasons["slope_pct"] = ""
            if pd.notna(forest):
                base["forest_cover_pct"] = forest
                base["forest_source_code"] = forest_code
                reasons["forest_cover_pct"] = ""
            if pd.notna(impervious):
                base["impervious_surface_pct"] = impervious
                base["impervious_source_code"] = imperv_code
                reasons["impervious_surface_pct"] = ""
            for key in reasons:
                if not reasons[key]:
                    continue
                codes = {
                    "drainage_area_sqmi": "DRNAREA", "mean_basin_elevation_m": "ELEV",
                    "slope_pct": "BSLDEM10M/BSLDEM30M/BSLDEM30FT", "forest_cover_pct": "FOREST",
                    "impervious_surface_pct": "IMPERV/LC11IMP",
                }[key]
                if not any(str(item.get("code", "")).upper() in codes.split("/") for item in hydro_features):
                    reasons[key] = f"Current SS-Hydro response did not provide {codes} for region {region}"
                elif reasons[key] == "not retrieved":
                    matching = [item for item in hydro_features
                                if str(item.get("code", "")).upper() in codes.split("/")]
                    point_only = any("pointextract" in str(item.get("msg", "")).replace(" ", "").lower()
                                     for item in matching)
                    reasons[key] = (f"Current SS-Hydro {codes} was point-extracted, not computed as a basin characteristic"
                                    if point_only else f"Current SS-Hydro {codes} value missing, nonnumeric, or sentinel")
        if not verified:
            for key in reasons:
                base[key] = np.nan
                reasons[key] = "; ".join(verification_reasons) or "Watershed verification failed"
            base["mean_basin_elevation_source_code"] = None
            base["slope_source_code"] = None
            base["forest_source_code"] = None
            base["impervious_source_code"] = None
        status = "verified" if verified else "unverified: " + "; ".join(verification_reasons)
        result_rows.append({**base, "delineation_verified": verified,
                            "delineation_status": status,
                            "snapped_point_distance_m": snapped_distance,
                            "returned_huc": huc_result,
            "huc_verification_note": station_status_huc_note if huc_matches is None else "HUC matches" if huc_matches else "HUC mismatch",
                            **{f"{k}_missing_reason": v for k, v in reasons.items()}})
        station_status[station_id] = {
            "status": status, "region": region, "input_coordinate": [float(row.longitude), float(row.latitude)],
            "returned_huc": huc_result, "usgs_huc": huc_source,
            "input_coordinate_inside_basin": input_inside,
            "snapped_point_distance_m": snapped_distance,
            "warning": warning, "verification_reasons": verification_reasons,
        }
    df = pd.DataFrame(result_rows)
    df.to_csv(RAW / "streamstats_catchment_attributes.csv", index=False, encoding="utf-8")
    return df, station_status


def build_integrated_dataset(discharge: pd.DataFrame, weather: pd.DataFrame,
                             catchment: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    if discharge.empty or weather.empty:
        joined = pd.DataFrame()
        return joined, {"status": "not_ready", "reason": "No discharge or weather rows were retrieved"}
    discharge = discharge.copy()
    weather = weather.copy()
    catchment = catchment.copy()
    discharge["station_id"] = discharge.station_id.astype("string").str.zfill(8)
    weather["station_id"] = weather.station_id.astype("string").str.zfill(8)
    catchment["station_id"] = catchment.station_id.astype("string").str.zfill(8)
    for df in (discharge, weather):
        df["date"] = pd.to_datetime(df.date, errors="coerce").dt.strftime("%Y-%m-%d")
    if discharge.duplicated(["station_id", "date"]).any():
        raise ValueError("USGS discharge has duplicate station-date keys; refusing integration")
    if weather.duplicated(["station_id", "date"]).any():
        raise ValueError("Open-Meteo weather has duplicate station-date keys; refusing integration")
    if catchment.station_id.duplicated().any():
        raise ValueError("Catchment attributes have duplicate station IDs; refusing integration")
    # Include only actual daily weather rows from the API. Public test-station
    # discharge was never fetched, so its discharge_cfs remains missing.
    joined = weather.merge(discharge, on=["station_id", "date"], how="left", validate="one_to_one")
    joined = joined.merge(catchment, on="station_id", how="left", validate="many_to_one")
    joined.to_csv(PROCESSED / "floodcast_dataset.csv", index=False, encoding="utf-8")
    keyed = weather.merge(discharge[["station_id", "date"]].assign(_matched=True),
                          on=["station_id", "date"], how="left", validate="one_to_one")
    return joined, {
        "status": "ready" if joined.discharge_cfs.notna().any() else "not_ready",
        "weather_rows": int(len(weather)), "discharge_rows": int(len(discharge)),
        "integrated_rows": int(len(joined)), "rows_with_discharge": int(joined.discharge_cfs.notna().sum()),
        "rows_without_discharge": int(joined.discharge_cfs.isna().sum()),
        "missing_value_counts": {str(k): int(v) for k, v in joined.isna().sum().items()},
        "duplicate_station_date_rows": int(joined.duplicated(["station_id", "date"]).sum()),
        "weather_rows_without_discharge_match": int(keyed._matched.isna().sum()),
        "weather_station_ids": sorted(weather.station_id.unique().tolist()),
        "discharge_station_ids": sorted(discharge.station_id.unique().tolist()),
        "catchment_verified_stations": sorted(catchment.loc[catchment.delineation_verified, "station_id"].astype(str).tolist())
            if "delineation_verified" in catchment else [],
        "unverified_catchment_station_ids": sorted(catchment.loc[~catchment.delineation_verified, "station_id"].astype(str).tolist())
            if "delineation_verified" in catchment else [],
    }


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    train, test, source_metadata, weather_start, weather_end = parse_input_keys()
    train_ids = sorted(train.station_id.astype(str).unique().tolist())
    all_ids = sorted(set(train_ids) | set(test.station_id.astype(str).unique().tolist()))
    data_provenance: dict[str, Any] = {
        "project": "FLOODCAST V2", "started_at_utc": now_utc(),
        "input_station_ids_from_train_csv": train_ids,
        "input_station_ids_from_test_csv": sorted(test.station_id.astype(str).unique().tolist()),
        "weather_date_range": [weather_start, weather_end],
        "train_date_range_by_station": {
            str(station): [group.date.min().date().isoformat(), group.date.max().date().isoformat()]
            for station, group in train.groupby("station_id", sort=True)
        },
        "test_date_range_by_station": {
            str(station): [group.date.min().date().isoformat(), group.date.max().date().isoformat()]
            for station, group in test.groupby("station_id", sort=True)
        },
        "usgs_discharge_policy": "Only station IDs/dates present in train.csv are requested; test station discharge is never requested.",
        "openmeteo_model": "ERA5; a single consistent model is used because official Open-Meteo docs list precipitation unavailable for ERA5-Land while soil moisture is available for ERA5.",
        "streamstats_services": {"delineation": SS_DELINEATE, "basin_characteristics": SS_HYDRO,
                                 "national_streamflow_statistics": "Investigated; not used because this acquisition requests measured discharge and catchment attributes, not regression-estimated flow statistics."},
        "sources": {},
    }

    metadata, _ = get_station_metadata(all_ids)
    source_metadata = source_metadata.copy()
    source_metadata["station_id"] = source_metadata.station_id.astype(str).str.zfill(8)
    official = metadata.set_index("station_id")
    metadata_audit = []
    for item in source_metadata.to_dict("records"):
        sid = str(item["station_id"])
        official_row = official.loc[sid] if sid in official.index else pd.Series(dtype=object)
        comparisons = {}
        for key in ("latitude", "longitude"):
            old = pd.to_numeric(pd.Series([item.get(key)]), errors="coerce").iloc[0]
            new = pd.to_numeric(pd.Series([official_row.get(key)]), errors="coerce").iloc[0]
            comparisons[key] = {"input": None if pd.isna(old) else float(old),
                                "usgs": None if pd.isna(new) else float(new),
                                "matches_within_1e-5_deg": bool(pd.notna(old) and pd.notna(new) and abs(float(old)-float(new)) <= 1e-5)}
        old_huc = str(item.get("huc", "")) if "huc" in source_metadata.columns else ""
        new_huc = str(official_row.get("huc", ""))
        huc_related = bool(old_huc.isdigit() and new_huc.isdigit()
                           and (old_huc.startswith(new_huc) or new_huc.startswith(old_huc)))
        comparisons["huc"] = {"input": old_huc or None, "usgs": new_huc or None,
                               "comparison_available": bool(old_huc),
                               "prefix_related": huc_related if old_huc else None}
        comparisons["state"] = {"input": str(item.get("state", "")),
                                 "usgs": str(official_row.get("state", "")),
                                 "matches": str(item.get("state", "")) == str(official_row.get("state", ""))}
        metadata_audit.append({"station_id": sid, "checks": comparisons})
    data_provenance["existing_station_metadata_crosscheck"] = metadata_audit
    data_provenance["sources"]["usgs_station_metadata"] = {
        "api": f"{USGS_BASE}/monitoring-locations/items", "retrieved_at_utc": now_utc(),
        "rows": int(len(metadata)), "stations": metadata.station_id.astype(str).tolist(),
        "missing_counts": {str(k): int(v) for k, v in metadata.isna().sum().items()},
    }
    discharge, discharge_status = fetch_usgs_discharge(train)
    data_provenance["sources"]["usgs_daily_discharge"] = {
        "api": f"{USGS_BASE}/daily/items", "retrieved_at_utc": now_utc(),
        "parameter_code": "00060", "statistic_id": "00003", "expected_units": "ft^3/s (cfs)",
        "requested_stations": train_ids, "test_station_ids_excluded": sorted(set(all_ids) - set(train_ids)),
        "records": int(len(discharge)), "stations": discharge_status,
        "missing_values": int(discharge.discharge_cfs.isna().sum()) if not discharge.empty else 0,
        "duplicate_station_date_rows": int(discharge.duplicated(["station_id", "date"]).sum()) if not discharge.empty else 0,
    }
    weather, weather_status = fetch_openmeteo_weather(metadata, weather_start, weather_end)
    data_provenance["sources"]["openmeteo_weather"] = {
        "api": OPEN_METEO_URL, "retrieved_at_utc": now_utc(), "model": "ERA5", "timezone": "UTC",
        "requested_date_range": [weather_start, weather_end], "records": int(len(weather)),
        "stations": weather_status,
        "missing_values": {str(k): int(v) for k, v in weather.isna().sum().items()},
        "units": {"precipitation_mm": "mm/day", "temp_max_c": "°C", "temp_min_c": "°C",
                  "temp_mean_c": "°C", "soil_moisture_0_7cm": "m³/m³ daily mean of 24 hourly values",
                  "soil_moisture_7_28cm": "m³/m³ daily mean of 24 hourly values; null if unavailable"},
    }
    catchment, catchment_status = fetch_streamstats(metadata)
    data_provenance["sources"]["streamstats_catchment"] = {
        "services": {"delineation": SS_DELINEATE, "hydro": SS_HYDRO},
        "retrieved_at_utc": now_utc(), "stations": catchment_status,
        "records": int(len(catchment)),
        "missing_values": {str(k): int(v) for k, v in catchment.isna().sum().items()},
        "units": {"drainage_area_sqmi": "square miles", "mean_basin_elevation_m": "meters",
                  "slope_pct": "%", "forest_cover_pct": "%", "impervious_surface_pct": "%"},
    }
    integrated, integration = build_integrated_dataset(discharge, weather, catchment)
    data_provenance["integration"] = integration
    data_provenance["http_requests"] = REQUEST_LOG
    data_provenance["failed_requests"] = FAILURES
    recovered_failures, terminal_failures = [], []
    for failure in FAILURES:
        recovered = any(
            request.get("source") == failure.get("source")
            and request.get("station_id") == failure.get("station_id")
            and isinstance(request.get("http_status"), int)
            and 200 <= request.get("http_status") < 300
            and request.get("retrieved_at_utc", "") > failure.get("retrieved_at_utc", "")
            for request in REQUEST_LOG
        )
        (recovered_failures if recovered else terminal_failures).append(failure)
    expected_discharge_rows = int(len(train))
    expected_weather_rows = len(all_ids) * (
        (pd.Timestamp(weather_end).normalize() - pd.Timestamp(weather_start).normalize()).days + 1
    )
    coverage_checks = {
        "expected_training_station_date_keys": expected_discharge_rows,
        "actual_training_discharge_rows": int(len(discharge)),
        "training_discharge_key_coverage_complete": bool(len(discharge) == expected_discharge_rows and not discharge.duplicated(["station_id", "date"]).any()),
        "expected_weather_station_daily_keys_over_contiguous_ranges": int(expected_weather_rows),
        "actual_weather_rows": int(len(weather)),
        "weather_coverage_complete_for_contiguous_ranges": bool(len(weather) == expected_weather_rows),
        "weather_missing_feature_counts": {str(k): int(v) for k, v in weather.isna().sum().items()},
        "unmatched_test_weather_rows": int(integration.get("weather_rows_without_discharge_match", 0)),
    }
    data_provenance["recovered_request_failures"] = recovered_failures
    data_provenance["terminal_failures"] = terminal_failures
    data_provenance["coverage_checks"] = coverage_checks
    data_provenance["completed_at_utc"] = now_utc()
    data_provenance["training_ready"] = bool(
        integration.get("status") == "ready" and integration.get("rows_with_discharge", 0) > 0
        and not terminal_failures and coverage_checks["training_discharge_key_coverage_complete"]
        and coverage_checks["weather_coverage_complete_for_contiguous_ranges"]
        and not catchment.empty and catchment.delineation_verified.all()
    )
    data_provenance["training_ready_reason"] = (
        "All requested sources joined and every catchment passed verification."
        if data_provenance["training_ready"] else
        "Full-source training is not ready: review terminal failures, source coverage, and catchment verification. "
        f"Verified catchments: {int(catchment.delineation_verified.sum()) if not catchment.empty else 0}/"
        f"{len(catchment)}; unverified station IDs: "
        f"{catchment.loc[~catchment.delineation_verified, 'station_id'].astype(str).tolist() if not catchment.empty else []}."
    )
    (PROCESSED / "data_provenance.json").write_text(json.dumps(data_provenance, indent=2, default=str), encoding="utf-8")
    (RAW / "acquisition_failures.json").write_text(json.dumps(FAILURES, indent=2, default=str), encoding="utf-8")
    summary = {
        "raw_files": sorted(str(p.relative_to(ROOT)) for p in RAW.rglob("*") if p.is_file()),
        "processed_files": sorted(str(p.relative_to(ROOT)) for p in PROCESSED.rglob("*") if p.is_file()),
        "usgs_discharge_records": int(len(discharge)), "weather_records": int(len(weather)),
        "integrated_records": int(len(integrated)), "stations": {
            "usgs_discharge": discharge_status, "weather": weather_status,
            "streamstats": catchment_status,
        },
        "failed_request_count": len(FAILURES), "recovered_request_failure_count": len(recovered_failures),
        "terminal_failure_count": len(terminal_failures), "coverage_checks": coverage_checks,
        "training_ready": data_provenance["training_ready"],
        "predictions_csv_modified": False, "model_files_modified": False,
    }
    (PROCESSED / "acquisition_summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))
    # A nonzero status is intentional when the output is incomplete or unverified.
    return 0 if data_provenance["training_ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
