"""Factory for the only model families used by the V2 blend."""
from __future__ import annotations

from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline


def build_model_set(random_state: int = 42):
    try:
        from catboost import CatBoostRegressor
        from lightgbm import LGBMRegressor
    except ImportError as exc:
        raise RuntimeError("Install requirements.txt to use the required HGB/CatBoost/LightGBM blend") from exc

    def pipeline(estimator):
        return make_pipeline(
            SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
            estimator,
        )

    return {
        "hgb": pipeline(HistGradientBoostingRegressor(
            max_iter=180, learning_rate=0.05, max_leaf_nodes=15,
            l2_regularization=2.0, random_state=random_state,
        )),
        "cat": pipeline(CatBoostRegressor(
            iterations=240, depth=6, learning_rate=0.04, loss_function="RMSE",
            l2_leaf_reg=6, random_seed=random_state, verbose=False,
            allow_writing_files=False, thread_count=-1,
        )),
        "lgb": pipeline(LGBMRegressor(
            n_estimators=220, learning_rate=0.035, num_leaves=15,
            min_child_samples=30, reg_lambda=3.0, subsample=0.9,
            subsample_freq=1, colsample_bytree=0.9, verbosity=-1,
            random_state=random_state, n_jobs=-1,
        )),
    }
