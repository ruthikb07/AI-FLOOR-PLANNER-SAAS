import sqlite3
import sys
import math
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from section_contour_cache import exact_contour


def test_exact_signed_inputs_resolution_and_corrupt_receipt(tmp_path, monkeypatch):
    monkeypatch.setenv("RH_SECTION_CACHE_DIR", str(tmp_path))
    calls = []
    def solve(section, axial, points):
        def compute():
            calls.append((section, axial, points))
            return [10., 20., [axial] * (points + 1), [0.] * (points + 1)]
        return exact_contour(section, axial, points, compute)

    section = (25., 500., (300., 400.), (), ((40., 40., 200.),))
    assert solve(section, 15., 20) == solve(section, 15., 20)
    assert len(calls) == 1
    solve(section, -15., 20)
    solve(section, 15., 36)
    solve((*section[:-1], ((41., 40., 200.),)), 15., 20)
    assert len(calls) == 4
    with sqlite3.connect(tmp_path / "fiber-contours.sqlite3") as db:
        db.execute("UPDATE contours SET body='[]'")
    solve(section, 15., 20)
    assert len(calls) == 5


@pytest.mark.parametrize("axial_kn", [-50., 220.])
def test_cached_rectangle_reproduces_every_signed_upstream_moment(axial_kn, tmp_path, monkeypatch):
    from worker_main import _build_section, _biaxial_contour
    bars = tuple((x,y,200.) for x in (40.,260.) for y in (40.,410.))
    key = (30., 500., (300.,450.), (), bars)
    monkeypatch.setenv('RH_SECTION_CACHE_DIR', str(tmp_path))
    _biaxial_contour(key, axial_kn, 20)
    _biaxial_contour.cache_clear()
    _, _, xs, ys = _biaxial_contour(key, axial_kn, 20)
    section, _ = _build_section(*key)
    reference = section.biaxial_bending_diagram(n=axial_kn*1000, n_points=20, progress_bar=False)
    rx, ry = reference.get_results_lists()
    for got, expected in zip(xs+ys, rx+ry, strict=True):
        assert math.isclose(got, expected/1e6, rel_tol=1e-6, abs_tol=1e-7)
