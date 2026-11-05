"""Leakage-safe features built only from date-keyed input predictors."""
from __future__ import annotations

import numpy as np
import pandas as pd

WEATHER = ["precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture"]
STATIC = ["drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]


def make_features(train: pd.DataFrame, test: pd.DataFrame, context: pd.DataFrame | None = None,
                  feature_set: str = "standard") -> tuple[pd.DataFrame, pd.DataFrame]:
    """Feature both splits together so lagged test weather can use prior known weather.

    Discharge is never read here. Rolling windows include the current day and past
    days only; shifted features use strictly earlier rows for the same station.
    """
    n_train = len(train)
    requested = pd.concat([train.drop(columns=["discharge_cfs"], errors="ignore"), test], ignore_index=True, sort=False)
    requested["_request_order"] = np.arange(len(requested))
    if context is None:
        combined = requested.drop(columns="_request_order").copy()
    else:
        combined = context.drop(columns=["discharge_cfs"], errors="ignore").copy()
        if combined.duplicated(["station_id", "date"]).any():
            raise ValueError("feature context has duplicate (station_id, date) keys")
        # Add any requested keys missing from context; their available predictors
        # are retained, while context supplies historical weather for lag features.
        have = combined[["station_id", "date"]].drop_duplicates()
        missing = requested.merge(have, on=["station_id", "date"], how="left", indicator=True)
        missing = missing.loc[missing["_merge"] == "left_only", requested.columns.drop("_request_order")]
        combined = pd.concat([combined, missing], ignore_index=True, sort=False)
    if feature_set not in {"standard", "hydro_plus"}:
        raise ValueError("feature_set must be 'standard' or 'hydro_plus'")
    combined["_order"] = np.arange(len(combined))
    combined = combined.sort_values(["station_id", "date", "_order"], kind="mergesort").reset_index(drop=True)
    combined["day_of_year_sin"] = np.sin(2 * np.pi * combined.date.dt.dayofyear / 365.25)
    combined["day_of_year_cos"] = np.cos(2 * np.pi * combined.date.dt.dayofyear / 365.25)
    combined["month_sin"] = np.sin(2 * np.pi * combined.date.dt.month / 12)
    combined["month_cos"] = np.cos(2 * np.pi * combined.date.dt.month / 12)
    # Reindex each station onto a daily calendar so a seven-day lag means seven
    # calendar days, even when the source omits observations for some dates.
    for col in WEATHER:
        if col not in combined:
            continue
        for feature in [f"{col}_lag_{lag}" for lag in (1, 2, 3, 7)]:
            combined[feature] = np.nan
        for window in (3, 7, 14, 30):
            combined[f"{col}_rolling_{window}"] = np.nan
        if col == "precipitation_mm":
            for window in (3, 7, 14, 30):
                combined[f"precip_sum_{window}d"] = np.nan
            combined["antecedent_precip_index"] = np.nan
            if feature_set == "hydro_plus":
                for half_life in (3, 7, 14):
                    combined[f"antecedent_precip_{half_life}d"] = np.nan
                for window in (3, 7, 14):
                    combined[f"precip_max_{window}d"] = np.nan
                    combined[f"rainy_days_{window}d"] = np.nan
        for _, group in combined.groupby("station_id", sort=False):
            dates = pd.DatetimeIndex(group.date)
            daily_index = pd.date_range(dates.min(), dates.max(), freq="D")
            values = pd.to_numeric(group.set_index("date")[col], errors="coerce")
            daily = values.reindex(daily_index)
            row_ids = group.index
            for lag in (1, 2, 3, 7):
                combined.loc[row_ids, f"{col}_lag_{lag}"] = daily.shift(lag).reindex(dates).to_numpy()
            for window in (3, 7, 14, 30):
                combined.loc[row_ids, f"{col}_rolling_{window}"] = daily.rolling(f"{window}D", min_periods=1).mean().reindex(dates).to_numpy()
            if col == "precipitation_mm":
                for window in (3, 7, 14, 30):
                    combined.loc[row_ids, f"precip_sum_{window}d"] = daily.rolling(f"{window}D", min_periods=1).sum().reindex(dates).to_numpy()
                combined.loc[row_ids, "antecedent_precip_index"] = daily.fillna(0).ewm(alpha=0.25, adjust=False).mean().reindex(dates).to_numpy()
                if feature_set == "hydro_plus":
                    for half_life in (3, 7, 14):
                        alpha = 1.0 - np.exp(np.log(0.5) / half_life)
                        combined.loc[row_ids, f"antecedent_precip_{half_life}d"] = daily.fillna(0).ewm(alpha=alpha, adjust=False).mean().reindex(dates).to_numpy()
                    for window in (3, 7, 14):
                        combined.loc[row_ids, f"precip_max_{window}d"] = daily.rolling(f"{window}D", min_periods=1).max().reindex(dates).to_numpy()
                        combined.loc[row_ids, f"rainy_days_{window}d"] = daily.ge(1.0).rolling(f"{window}D", min_periods=1).sum().reindex(dates).to_numpy()
    if "temp_max_c" in combined and "temp_min_c" in combined:
        combined["temperature_range_c"] = combined.temp_max_c - combined.temp_min_c
        if feature_set == "hydro_plus":
            combined["temperature_mean_c"] = (combined.temp_max_c + combined.temp_min_c) / 2.0
            combined["degree_day_proxy_0c"] = combined.temperature_mean_c.clip(lower=0)
            for window in (7, 30):
                combined[f"degree_day_proxy_{window}d"] = np.nan
            for _, group in combined.groupby("station_id", sort=False):
                dates = pd.DatetimeIndex(group.date)
                daily_index = pd.date_range(dates.min(), dates.max(), freq="D")
                values = combined.loc[group.index, "degree_day_proxy_0c"].set_axis(dates).reindex(daily_index)
                for window in (7, 30):
                    combined.loc[group.index, f"degree_day_proxy_{window}d"] = values.rolling(f"{window}D", min_periods=1).sum().reindex(dates).to_numpy()
    if feature_set == "hydro_plus" and "drainage_area_sqmi" in combined:
        area = pd.to_numeric(combined["drainage_area_sqmi"], errors="coerce").clip(lower=0)
        if "precip_sum_7d" in combined:
            combined["precip_area_proxy_7d"] = combined["precip_sum_7d"] * area
        if "antecedent_precip_7d" in combined:
            combined["api_area_proxy_7d"] = combined["antecedent_precip_7d"] * area
    features = [c for c in combined.columns if c not in {"station_id", "date", "_order"}]
    # A numeric station ID or name must never become a memorized station feature.
    combined[features] = combined[features].apply(pd.to_numeric, errors="coerce")
    combined[features] = combined[features].replace([np.inf, -np.inf], np.nan)
    encoded = combined[["station_id", "date"] + features]
    aligned = requested[["station_id", "date", "_request_order"]].merge(
        encoded, on=["station_id", "date"], how="left", validate="one_to_one"
    ).sort_values("_request_order", kind="mergesort")
    x_train = aligned.iloc[:n_train][features].reset_index(drop=True)
    x_test = aligned.iloc[n_train:][features].reset_index(drop=True)
    return x_train, x_test
