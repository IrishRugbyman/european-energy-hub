"""Unit tests for analytics.imbalance.weekday_baseline_signs (causal day-of-week baseline)."""

import numpy as np
import pytest
from analytics.imbalance import weekday_baseline_signs


def test_weekday_baseline_majority_positive_predicts_up():
    # Three prior Mondays, two positive: share 2/3 >= 0.5.
    out = weekday_baseline_signs(np.zeros(4), np.array([1.0, 2.0, -1.0, 0.0]), start=3)
    assert out.tolist() == [1.0]


def test_weekday_baseline_excludes_the_predicted_day():
    # Day 2 is positive but its window [0, 2) is all negative, so it must predict -1.
    out = weekday_baseline_signs(np.zeros(3), np.array([-1.0, -1.0, 5.0]), start=2)
    assert out.tolist() == [-1.0]


def test_weekday_baseline_respects_trailing_window():
    # Full history is 3/5 positive (+1), but the 2-row window [3, 5) is all negative.
    y = np.array([1.0, 1.0, 1.0, -1.0, -1.0, 0.0])
    assert weekday_baseline_signs(np.zeros(6), y, start=5, train=2).tolist() == [-1.0]
    assert weekday_baseline_signs(np.zeros(6), y, start=5, train=10).tolist() == [1.0]


def test_weekday_baseline_does_not_mix_weekdays():
    # Mondays negative, Tuesdays positive. Pooled, the share would be 0.5 (-> +1);
    # per weekday the Monday share is 0 (-> -1).
    dow = np.array([0, 1, 0, 1, 0])
    y = np.array([-1.0, 1.0, -1.0, 1.0, 9.0])
    assert weekday_baseline_signs(dow, y, start=4).tolist() == [-1.0]


def test_weekday_baseline_unseen_weekday_falls_back_to_up():
    out = weekday_baseline_signs(np.array([0, 0, 1]), np.array([-1.0, -1.0, -1.0]), start=2)
    assert out.tolist() == [1.0]


def test_weekday_baseline_tie_predicts_up():
    out = weekday_baseline_signs(np.zeros(3), np.array([1.0, -1.0, 0.0]), start=2)
    assert out.tolist() == [1.0]


def test_weekday_baseline_zero_excess_counts_as_not_positive():
    # A zero excess is not above trend: window [0, 0] has share 0 -> -1.
    out = weekday_baseline_signs(np.zeros(3), np.array([0.0, 0.0, 1.0]), start=2)
    assert out.tolist() == [-1.0]


def test_weekday_baseline_start_out_of_range_raises():
    with pytest.raises(ValueError):
        weekday_baseline_signs(np.zeros(3), np.zeros(3), start=4)


def test_weekday_baseline_length_matches_oos_rows():
    rng = np.random.default_rng(0)
    y = rng.normal(size=40)
    dow = np.arange(40) % 7
    assert len(weekday_baseline_signs(dow, y, start=25, train=10)) == 15
