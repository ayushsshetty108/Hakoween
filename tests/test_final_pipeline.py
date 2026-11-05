from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from solution import verify_submission_guardrails
from src.data.preprocessing import validate_inputs
from src.hydrology.features import make_features
from src.models.flood_detection import SpecificDischargeTransformer
from src.validation.cross_validation import METRIC_WEIGHTS, compute_weighted_score
from validate_submission import validate_submission


def sample_frame(stations=("A", "B"), target=True):
    rows = []
    for station in stations:
        for day in range(1, 4):
            row = {
                "station_id": station,
                "date": pd.Timestamp(2024, 1, day),
                "precipitation_mm": float(day),
                "temp_max_c": 10.0 + day,
                "temp_min_c": 2.0 + day,
                "soil_moisture": 0.2,
                "drainage_area_sqmi": 25.0,
                "mean_elevation_ft": 1000.0,
                "slope_pct": 1.0,
                "forest_cover_pct": 50.0,
            }
            if target:
                row["discharge_cfs"] = float(day * 10)
            rows.append(row)
    return pd.DataFrame(rows)


class FinalPipelineTests(unittest.TestCase):
    def test_specific_discharge_round_trip(self):
        transform = SpecificDischargeTransformer(use_log=False)
        q = np.array([0.0, 40.0, 125.0])
        area = np.array([2.0, 4.0, 25.0])
        specific = transform.fit(q, area).transform(q, area)
        np.testing.assert_allclose(specific, [0.0, 10.0, 5.0])
        np.testing.assert_allclose(transform.inverse_transform(specific, area), q)

    def test_missing_or_invalid_drainage_area_fails(self):
        transformer = SpecificDischargeTransformer()
        with self.assertRaisesRegex(ValueError, "strictly positive"):
            transformer.transform([10.0], [np.nan])
        train = sample_frame(("A",))
        test = sample_frame(("Z",), target=False)
        test.loc[0, "drainage_area_sqmi"] = np.nan
        with self.assertRaisesRegex(ValueError, "No fallback area is inferred"):
            validate_inputs(train, test)

    def test_train_test_feature_columns_match(self):
        train = sample_frame(("A",))
        test = sample_frame(("Z",), target=False)
        x_train, x_test = make_features(train, test, feature_set="hydro_plus")
        self.assertEqual(list(x_train.columns), list(x_test.columns))
        self.assertTrue(all(pd.api.types.is_numeric_dtype(dtype) for dtype in x_train.dtypes))

    def test_guardrail_preserves_prediction_order(self):
        test = sample_frame(("A",), target=False).iloc[:2].copy()
        pred = pd.DataFrame({
            "station_id": test.station_id.astype(str).to_numpy(),
            "date": test.date.dt.strftime("%Y-%m-%d").to_numpy(),
            "discharge_cfs": [3.0, 4.0],
        })
        verify_submission_guardrails(test, pred)
        pred = pred.iloc[::-1].reset_index(drop=True)
        with self.assertRaisesRegex(ValueError, "row order"):
            verify_submission_guardrails(test, pred)

    def test_exact_scoring_weights_and_normalization(self):
        self.assertEqual(METRIC_WEIGHTS, {
            "overall_rmse": 0.40, "extreme_rmse": 0.30, "mae": 0.20, "r2": 0.10,
        })
        metrics = {"overall_rmse": 5, "extreme_rmse": 8, "mae": 2, "r2": 0.5}
        best = {"overall_rmse": 0, "extreme_rmse": 0, "mae": 0, "r2": 1}
        worst = {"overall_rmse": 10, "extreme_rmse": 10, "mae": 4, "r2": -1}
        score, parts = compute_weighted_score(metrics, best, worst)
        expected_parts = {"overall_rmse": 50, "extreme_rmse": 20, "mae": 50, "r2": 75}
        self.assertEqual(parts, expected_parts)
        self.assertAlmostEqual(score, 43.5)

    def test_submission_validator_passes_valid_csv_and_flags_bad_row_order(self):
        test = sample_frame(("A",), target=False).iloc[:2].copy()
        pred = pd.DataFrame({
            "station_id": test.station_id.astype(str),
            "date": test.date.dt.strftime("%Y-%m-%d"),
            "discharge_cfs": [3.0, 4.0],
        })
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            folder = Path(folder)
            test_path, pred_path = folder / "test.csv", folder / "predictions.csv"
            test.to_csv(test_path, index=False)
            pred.to_csv(pred_path, index=False)
            self.assertTrue(all(ok for _, ok, _ in validate_submission(test_path, pred_path)))
            pred.iloc[::-1].to_csv(pred_path, index=False)
            outcomes = dict((name, ok) for name, ok, _ in validate_submission(test_path, pred_path))
            self.assertFalse(outcomes["Original test-row ordering preserved"])


if __name__ == "__main__":
    unittest.main()
