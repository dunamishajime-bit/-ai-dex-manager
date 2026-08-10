from __future__ import annotations

import numpy as np
import pandas as pd

import run_pair_wave_classifier_proxy as target


def fixed_yrmask(x: pd.DataFrame, start_year: int, end_year_exclusive: int, label_safe: bool = False) -> np.ndarray:
    start = pd.Timestamp(f"{start_year}-01-01", tz="UTC")
    end = pd.Timestamp(f"{end_year_exclusive}-01-01", tz="UTC")
    if label_safe:
        end -= pd.Timedelta(minutes=15 * target.LABEL_HORIZON)
    return np.asarray((x.index >= start) & (x.index < end), dtype=bool)


target.yrmask = fixed_yrmask

if __name__ == "__main__":
    target.main()
