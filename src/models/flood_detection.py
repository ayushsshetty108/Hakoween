"""Target transformation for basin-size-normalized discharge."""
from __future__ import annotations

import numpy as np


class SpecificDischargeTransformer:
    """Convert Q in cfs to specific discharge Q/A and back.

    Log transforms are deliberately disabled for this V2 model.
    """

    def __init__(self, use_log: bool = False):
        if use_log is not False:
            raise ValueError("FLOODCAST V2 requires use_log=False")
        self.use_log = False

    @staticmethod
    def _validated_area(drainage_area_sqmi, expected_length: int) -> np.ndarray:
        area = np.asarray(drainage_area_sqmi, dtype=float).reshape(-1)
        if len(area) != expected_length:
            raise ValueError("Drainage-area length must match discharge length")
        if not np.isfinite(area).all() or (area <= 0).any():
            raise ValueError("drainage_area_sqmi must be finite and strictly positive")
        return area

    def fit(self, discharge_cfs, drainage_area_sqmi):
        discharge = np.asarray(discharge_cfs, dtype=float).reshape(-1)
        self._validated_area(drainage_area_sqmi, len(discharge))
        if not np.isfinite(discharge).all() or (discharge < 0).any():
            raise ValueError("discharge_cfs must be finite and non-negative")
        return self

    def transform(self, discharge_cfs, drainage_area_sqmi) -> np.ndarray:
        discharge = np.asarray(discharge_cfs, dtype=float).reshape(-1)
        area = self._validated_area(drainage_area_sqmi, len(discharge))
        if not np.isfinite(discharge).all() or (discharge < 0).any():
            raise ValueError("discharge_cfs must be finite and non-negative")
        return discharge / area

    def inverse_transform(self, specific_discharge, drainage_area_sqmi) -> np.ndarray:
        specific = np.asarray(specific_discharge, dtype=float).reshape(-1)
        area = self._validated_area(drainage_area_sqmi, len(specific))
        if not np.isfinite(specific).all():
            raise ValueError("Predicted specific discharge must be finite")
        return np.maximum(specific, 0.0) * area
