"""Fetch Open-Meteo ERA5 weather only for expanded stations still missing it."""
from __future__ import annotations
import json
import time
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import requests
from src.data.expand_station_dataset import ROOT, RAW, OPEN_METEO, START


def main():
    out = ROOT / "data" / "expanded_24_station"
    manifest = json.loads((out / "station_expansion_manifest.json").read_text(encoding="utf-8"))
    missing = list(manifest.get("weather_unavailable_station_ids", []))
    metadata = pd.read_csv(out / "added_station_metadata.csv", dtype={"station_id": "string"})
    metadata["station_id"] = metadata.station_id.astype("string").str.zfill(8)
    request_log, failures = [], []
    for index, station in enumerate(missing):
        row = metadata.loc[metadata.station_id == station].iloc[0]
        params = {"latitude": float(row.latitude), "longitude": float(row.longitude),
                  "start_date": START, "end_date": "2019-12-31",
                  "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean",
                  "hourly": "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm",
                  "timezone": "UTC", "models": "era5"}
        path = RAW / "openmeteo_responses" / f"openmeteo_{station}.json"
        response = None
        for attempt in range(1, 4):
            try:
                response = requests.get(OPEN_METEO, params=params, timeout=(15, 90),
                                        headers={"User-Agent": "FLOODCAST-V2-weather-resume/1.0"})
                request_log.append({"station_id":station,"time_utc":datetime.now(timezone.utc).isoformat(),
                                    "status":response.status_code,"attempt":attempt,"url":response.url,
                                    "response_bytes":len(response.content)})
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(response.content)
                if response.ok:
                    data = response.json()
                    if data.get("error") or not data.get("daily", {}).get("time"):
                        raise ValueError(data.get("reason", "No daily values in response"))
                    break
                failures.append({"station_id":station,"status":response.status_code,
                                 "response":response.text[:2000],"attempt":attempt})
                if response.status_code == 429:
                    wait = max(60, int(response.headers.get("Retry-After", "60")))
                    print(f"Open-Meteo rate limit for {station}; waiting {wait}s before retry",flush=True)
                    time.sleep(wait)
                elif response.status_code in {408,425,500,502,503,504}:
                    time.sleep(min(2 ** attempt, 16))
                else:
                    break
            except Exception as exc:
                failures.append({"station_id":station,"status":getattr(response,"status_code",None),
                                 "error":repr(exc),"attempt":attempt})
                time.sleep(min(2 ** attempt, 16))
        else:
            response = None
        if response is None or not response.ok or response.status_code >= 400:
            raise RuntimeError(f"Weather retrieval did not complete for {station}; see acquisition_failures.json")
        print(f"Fetched ERA5 weather {index+1}/{len(missing)}: {station}",flush=True)
        # Stay below the free archive endpoint's short-window rate cap.
        if index == 6 and len(missing) > 7:
            time.sleep(60)
        else:
            time.sleep(2)
    report = {"source":"Open-Meteo Historical Archive ERA5","requested_station_ids":missing,
              "successful_station_ids":missing,"request_log":request_log,"retry_failures":failures,
              "completed_at_utc":datetime.now(timezone.utc).isoformat()}
    (out / "weather_resume_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({"success_count":len(missing),"stations":missing,"retry_failures":len(failures)},indent=2))


if __name__ == "__main__": main()
