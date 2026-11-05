from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from time import monotonic
import os

import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.hydrology.features import make_features


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(os.environ.get("FLOODCAST_MODEL_PATH", PROJECT_ROOT / "models/floodcast_final.joblib"))
TRAIN_PATH = PROJECT_ROOT / "data/expanded_24_station/train.csv"
STATION_PATH = PROJECT_ROOT / "data/raw/station_metadata.csv"
SUPPORTED_STATIONS = ("01646500", "02087500", "07010000", "08158000")
MODEL_FEATURES = ("precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture")
STATIC_FEATURES = ("drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct")
USGS_URL = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT = 15
PREDICTION_CACHE_SECONDS = 30 * 60
_cache_lock = RLock()
_prediction_cache: tuple[float, list[dict]] | None = None
_live_cache: tuple[float, dict] | None = None


def _load_model_and_data() -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    if not MODEL_PATH.is_file():
        raise RuntimeError(f"FLOODCAST model artifact is missing: {MODEL_PATH}")
    if not TRAIN_PATH.is_file() or not STATION_PATH.is_file():
        raise RuntimeError("FLOODCAST training data or station metadata is missing.")
    artifact = joblib.load(MODEL_PATH)
    train = pd.read_csv(TRAIN_PATH, dtype={"station_id": "string"})
    train["station_id"] = train["station_id"].astype(str).str.strip()
    train["date"] = pd.to_datetime(train["date"], errors="raise").dt.normalize()
    stations = pd.read_csv(STATION_PATH, dtype={"station_id": "string"})
    stations["station_id"] = stations["station_id"].astype(str).str.strip()
    return artifact, train, stations


MODEL_ARTIFACT, TRAIN_DATA, STATION_DATA = _load_model_and_data()


def _origins() -> list[str]:
    configured = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5190,http://127.0.0.1:5190,https://floodcast-cfq9.onrender.com",
    )
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app = FastAPI(title="FLOODCAST API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_origin_regex=r"https://[a-z0-9-]+\.onrender\.com",
    allow_methods=["GET"],
    allow_headers=["Accept"],
)


def _station_profiles() -> dict[str, dict]:
    profiles = {}
    for station_id in SUPPORTED_STATIONS:
        metadata = STATION_DATA.loc[STATION_DATA["station_id"] == station_id]
        history = TRAIN_DATA.loc[TRAIN_DATA["station_id"] == station_id].sort_values("date")
        if metadata.empty or history.empty:
            raise RuntimeError(f"Station {station_id} is missing coordinates or training context.")
        row = metadata.iloc[0]
        profile = {
            "station_id": station_id,
            "station_name": str(row.get("station_name", station_id)),
            "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]),
        }
        for feature in STATIC_FEATURES:
            values = pd.to_numeric(history[feature], errors="coerce").dropna()
            profile[feature] = float(values.iloc[-1]) if not values.empty else None
        profiles[station_id] = profile
    return profiles


STATION_PROFILES = _station_profiles()


def _open_meteo_daily(profile: dict) -> list[dict]:
    response = requests.get(
        OPEN_METEO_URL,
        params={
            "latitude": profile["latitude"],
            "longitude": profile["longitude"],
            "hourly": "soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm",
            "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
            "past_days": 3,
            "forecast_days": 7,
            "timezone": "UTC",
            "temperature_unit": "celsius",
            "precipitation_unit": "mm",
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    data = response.json()
    daily = data.get("daily") or {}
    hourly = data.get("hourly") or {}
    dates = daily.get("time") or []
    hourly_by_date: dict[str, list[int]] = {}
    for index, timestamp in enumerate(hourly.get("time") or []):
        hourly_by_date.setdefault(str(timestamp)[:10], []).append(index)

    rows = []
    for index, date in enumerate(dates):
        soil_values = []
        for hour_index in hourly_by_date.get(str(date), []):
            layers = (
                (hourly.get("soil_moisture_0_to_1cm"), hour_index, 1),
                (hourly.get("soil_moisture_1_to_3cm"), hour_index, 2),
                (hourly.get("soil_moisture_3_to_9cm"), hour_index, 4),
            )
            weighted = [(float(values[hour_index]), depth) for values, _, depth in layers
                        if values and values[hour_index] is not None]
            if weighted:
                soil_values.append(sum(value * depth for value, depth in weighted) / sum(depth for _, depth in weighted))
        rows.append({
            "station_id": profile["station_id"],
            "date": str(date),
            "precipitation_mm": (daily.get("precipitation_sum") or [None] * len(dates))[index],
            "temp_max_c": (daily.get("temperature_2m_max") or [None] * len(dates))[index],
            "temp_min_c": (daily.get("temperature_2m_min") or [None] * len(dates))[index],
            "soil_moisture": float(np.mean(soil_values)) if soil_values else np.nan,
            **{feature: profile[feature] for feature in STATIC_FEATURES},
        })
    return rows


def _predict_from_weather(weather_rows: list[dict]) -> list[dict]:
    today = datetime.now(timezone.utc).date().isoformat()
    future_rows = [row for row in weather_rows if row["date"] >= today]
    if not future_rows:
        return []

    forecast = pd.DataFrame(future_rows)
    forecast["station_id"] = forecast["station_id"].astype("string")
    forecast["date"] = pd.to_datetime(forecast["date"], errors="raise").dt.normalize()
    _, features = make_features(TRAIN_DATA, forecast, feature_set=MODEL_ARTIFACT["feature_set"])
    expected = MODEL_ARTIFACT["feature_names"]
    missing_features = sorted(set(expected) - set(features.columns))
    if missing_features:
        raise RuntimeError(f"Forecast feature generation is missing model inputs: {missing_features}")
    features = features.loc[:, expected]
    predicted_target = np.asarray(MODEL_ARTIFACT["model"].predict(features), dtype=float)
    transformer = MODEL_ARTIFACT.get("target_transformer")
    area = pd.to_numeric(forecast["drainage_area_sqmi"], errors="coerce").to_numpy(dtype=float)
    predictions = transformer.inverse_transform(predicted_target, area) if transformer is not None else predicted_target
    if not np.isfinite(predictions).all():
        raise RuntimeError("Model returned non-finite discharge forecasts.")

    generated_at = datetime.now(timezone.utc).isoformat()
    return [{
        "station_id": str(row.station_id),
        "generated_at": generated_at,
        "valid_time": row.date.strftime("%Y-%m-%d"),
        "predicted_discharge": max(0.0, float(value)),
        "unit": "cfs",
        "model_name": "FLOODCAST experimental discharge model",
        "weather_source": "Open-Meteo forecast model",
        "forecast_horizon": "daily; weather-model inputs",
        "is_operational_warning": False,
    } for row, value in zip(forecast.itertuples(index=False), predictions)]


def get_predictions(force: bool = False) -> list[dict]:
    global _prediction_cache
    with _cache_lock:
        if not force and _prediction_cache and monotonic() - _prediction_cache[0] < PREDICTION_CACHE_SECONDS:
            return _prediction_cache[1]
        with ThreadPoolExecutor(max_workers=len(SUPPORTED_STATIONS)) as executor:
            weather_rows = [
                row
                for station_rows in executor.map(_open_meteo_daily, STATION_PROFILES.values())
                for row in station_rows
            ]
        predictions = _predict_from_weather(weather_rows)
        _prediction_cache = (monotonic(), predictions)
        return predictions


def _fetch_usgs_measurements() -> dict[str, dict]:
    response = requests.get(
        USGS_URL,
        params={
            "f": "json",
            "monitoring_location_id": ",".join(f"USGS-{station}" for station in SUPPORTED_STATIONS),
            "parameter_code": "00060,00065",
            "limit": 100,
        },
        headers={"Accept": "application/geo+json, application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    stations = {station: {"station_id": station, "streamflow": None, "gauge_height": None, "risk": None} for station in SUPPORTED_STATIONS}
    for feature in payload.get("features", []):
        properties = feature.get("properties") or feature
        station_id = str(properties.get("monitoring_location_id") or "").removeprefix("USGS-")
        parameter = str(properties.get("parameter_code") or "")
        if station_id not in stations or parameter not in {"00060", "00065"}:
            continue
        raw_value = properties.get("value")
        try:
            value = float(raw_value) if raw_value not in (None, "") else None
        except (TypeError, ValueError):
            value = None
        if value is None or not np.isfinite(value):
            continue
        measurement = {
            "value": value,
            "time": properties.get("time") or properties.get("observation_time") or properties.get("date_time"),
            "unit": properties.get("unit_of_measure") or properties.get("unit"),
            "approval_status": properties.get("approval_status") or properties.get("approvals_status"),
            "parameter_code": parameter,
        }
        key = "streamflow" if parameter == "00060" else "gauge_height"
        current = stations[station_id][key]
        if current is None or str(measurement["time"] or "") > str(current["time"] or ""):
            stations[station_id][key] = measurement
    return stations


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": MODEL_ARTIFACT is not None,
        "supported_stations": list(SUPPORTED_STATIONS),
        "predictions": "experimental, based on Open-Meteo forecast inputs",
        "risk_thresholds": "not configured; risk classification intentionally omitted",
    }


@app.get("/api/stations")
def stations() -> dict:
    return {"stations": list(STATION_PROFILES.values())}


@app.get("/api/stations/live")
def live_stations() -> dict:
    global _live_cache
    with _cache_lock:
        if _live_cache and monotonic() - _live_cache[0] < 60:
            return _live_cache[1]
        try:
            measurements = _fetch_usgs_measurements()
        except requests.RequestException as error:
            raise HTTPException(status_code=502, detail=f"USGS live observations are unavailable: {error}") from error
        prediction_error = None
        try:
            predictions = get_predictions()
        except (requests.RequestException, RuntimeError, ValueError) as error:
            predictions = []
            prediction_error = str(error)
        by_station: dict[str, list[dict]] = {}
        for prediction in predictions:
            by_station.setdefault(prediction["station_id"], []).append(prediction)
        for station_id, station in measurements.items():
            series = by_station.get(station_id, [])
            station["predictions"] = series
            station["prediction"] = series[0] if series else None
        payload = {
            "stations": list(measurements.values()),
            "source": "USGS Water Data API",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "prediction_source": "FLOODCAST model with Open-Meteo forecast inputs" if predictions else None,
            "prediction_error": prediction_error,
            "risk_thresholds_configured": False,
        }
        _live_cache = (monotonic(), payload)
        return payload


@app.get("/api/predictions")
def predictions() -> dict:
    try:
        rows = get_predictions()
    except (requests.RequestException, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=f"FLOODCAST predictions are unavailable: {error}") from error
    return {
        "predictions": rows,
        "generated_at": rows[0]["generated_at"] if rows else None,
        "model_name": "FLOODCAST experimental discharge model",
        "warning": "Experimental discharge estimates only; not validated flood warnings or operational forecasts.",
    }


@app.get("/api/predictions/{station_id}")
def station_predictions(station_id: str) -> dict:
    if station_id not in SUPPORTED_STATIONS:
        raise HTTPException(status_code=404, detail=f"Unsupported station: {station_id}")
    try:
        rows = [row for row in get_predictions() if row["station_id"] == station_id]
    except (requests.RequestException, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=f"FLOODCAST predictions are unavailable: {error}") from error
    return {"station_id": station_id, "predictions": rows}


@app.get("/api/stations/{station_id}")
def station(station_id: str) -> dict:
    profile = STATION_PROFILES.get(station_id)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Unsupported station: {station_id}")
    return profile


@app.get("/api/stations/{station_id}/discharge")
def station_discharge(station_id: str) -> dict:
    if station_id not in SUPPORTED_STATIONS:
        raise HTTPException(status_code=404, detail=f"Unsupported station: {station_id}")
    path = PROJECT_ROOT / "data/raw/usgs_discharge.csv"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Historical discharge data is unavailable.")
    frame = pd.read_csv(path, dtype={"station_id": "string"})
    rows = frame.loc[frame["station_id"].astype(str) == station_id].replace({np.nan: None}).to_dict("records")
    return {"station_id": station_id, "records": rows}


@app.get("/api/stations/{station_id}/weather")
def station_weather(station_id: str) -> dict:
    if station_id not in SUPPORTED_STATIONS:
        raise HTTPException(status_code=404, detail=f"Unsupported station: {station_id}")
    path = PROJECT_ROOT / "data/raw/openmeteo_weather.csv"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Historical weather data is unavailable.")
    frame = pd.read_csv(path, dtype={"station_id": "string"})
    rows = frame.loc[frame["station_id"].astype(str) == station_id].replace({np.nan: None}).to_dict("records")
    return {"station_id": station_id, "records": rows}
