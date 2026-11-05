"""Fast HGB-only baseline using the same specific-discharge target."""
from __future__ import annotations

from .train_models import build_model_set


class FastHydroBaseline:
    def __init__(self, random_state: int = 42):
        self.random_state = random_state

    def fit(self, X, y_specific):
        self.model_ = build_model_set(self.random_state)["hgb"]
        self.model_.fit(X, y_specific)
        return self

    def predict(self, X):
        return self.model_.predict(X)
