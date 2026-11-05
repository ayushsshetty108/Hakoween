import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend import app as api


class BackendApiTests(unittest.TestCase):
    def test_health_reports_model_and_threshold_status(self):
        response = api.health()
        self.assertEqual(response["status"], "ok")
        self.assertTrue(response["model_loaded"])
        self.assertIn("not configured", response["risk_thresholds"])

    def test_model_generates_finite_forecast_rows_for_supported_station(self):
        station = api.STATION_PROFILES["01646500"]
        rows = []
        for offset in range(2):
            date = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
            rows.append({
                "station_id": station["station_id"],
                "date": date,
                "precipitation_mm": 1.0,
                "temp_max_c": 18.0,
                "temp_min_c": 9.0,
                "soil_moisture": 0.3,
                **{feature: station[feature] for feature in api.STATIC_FEATURES},
            })
        forecasts = api._predict_from_weather(rows)
        self.assertEqual(len(forecasts), 2)
        self.assertTrue(all(row["predicted_discharge"] >= 0 for row in forecasts))
        self.assertTrue(all(row["unit"] == "cfs" for row in forecasts))
        self.assertTrue(all(row["is_operational_warning"] is False for row in forecasts))

    def test_live_response_keeps_risk_unclassified_without_thresholds(self):
        api._live_cache = None
        measurement = {
            "01646500": {
                "station_id": "01646500",
                "streamflow": {"value": 10.0, "time": "2026-11-05T00:00:00Z", "unit": "ft3/s"},
                "gauge_height": None,
                "risk": None,
            }
        }
        prediction = {
            "station_id": "01646500",
            "generated_at": "2026-11-05T00:00:00Z",
            "valid_time": "2026-11-06",
            "predicted_discharge": 12.0,
            "unit": "cfs",
        }
        with patch.object(api, "_fetch_usgs_measurements", return_value=measurement), patch.object(
            api, "get_predictions", return_value=[prediction]
        ):
            response = api.live_stations()
        self.assertEqual(response["stations"][0]["prediction"], prediction)
        self.assertIsNone(response["stations"][0]["risk"])
        self.assertFalse(response["risk_thresholds_configured"])
        api._live_cache = None


if __name__ == "__main__":
    unittest.main()
