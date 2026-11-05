"""Fixed-weight, wet/dry gated HGB + CatBoost + LightGBM blend."""
from __future__ import annotations

import numpy as np
import pandas as pd
from .train_models import build_model_set


class RegimeGatedBlender:
    """Train the three required regressors and blend with fixed regime weights."""

    MODEL_NAMES = ("hgb", "cat", "lgb")
    REGIME_WEIGHTS = {
        "wet": {"hgb": 0.50, "cat": 0.35, "lgb": 0.15},
        "dry": {"hgb": 0.50, "cat": 0.35, "lgb": 0.15},
    }

    def __init__(self, random_state: int = 42):
        self.random_state = random_state

    def _regime(self, X: pd.DataFrame) -> np.ndarray:
        rain = pd.to_numeric(X.get("precipitation_mm", 0.0), errors="coerce")
        if not isinstance(rain, pd.Series):
            rain = pd.Series(np.full(len(X), float(rain)), index=X.index)
        soil = pd.to_numeric(X.get("soil_moisture", np.nan), errors="coerce")
        if not isinstance(soil, pd.Series):
            soil = pd.Series(np.full(len(X), float(soil)), index=X.index)
        soil_median = self.soil_moisture_median_
        wet = rain.fillna(0).gt(0) | soil.gt(soil_median).fillna(False)
        return np.where(wet.to_numpy(), "wet", "dry")

    def fit(self, X: pd.DataFrame, y_specific):
        required_weights = {"hgb": 0.50, "cat": 0.35, "lgb": 0.15}
        if self.REGIME_WEIGHTS != {"wet": required_weights, "dry": required_weights}:
            raise RuntimeError("Wet and dry regimes must both use exactly hgb=0.50, cat=0.35, lgb=0.15")
        target = np.asarray(y_specific, dtype=float).reshape(-1)
        if len(target) != len(X) or not np.isfinite(target).all() or (target < 0).any():
            raise ValueError("Specific-discharge target must be finite, non-negative, and row-aligned")
        soil = pd.to_numeric(X.get("soil_moisture", np.nan), errors="coerce")
        self.soil_moisture_median_ = float(soil.median()) if isinstance(soil, pd.Series) and soil.notna().any() else float("inf")
        self.estimators_ = build_model_set(self.random_state)
        for name in self.MODEL_NAMES:
            self.estimators_[name].fit(X, target)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if not hasattr(self, "estimators_"):
            raise RuntimeError("Call fit before predict")
        regimes = self._regime(X)
        predictions = {name: np.asarray(model.predict(X), dtype=float)
                       for name, model in self.estimators_.items()}
        output = np.zeros(len(X), dtype=float)
        for regime in ("wet", "dry"):
            rows = regimes == regime
            weights = self.REGIME_WEIGHTS[regime]
            output[rows] = sum(weights[name] * predictions[name][rows]
                               for name in self.MODEL_NAMES)
        return np.maximum(output, 0.0)
