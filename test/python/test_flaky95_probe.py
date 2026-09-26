"""Tests for the flaky-95 health probe in ``conftest`` (T150 follow-up #3).

The probe is a test tool with no tests of its own until now, so the four
contracts below are pinned here:

* threshold warnings fire once per metric, and only above the threshold;
* samples land as one JSON object per line carrying the expected fields;
* the probe stays inert when disabled and never raises into a test;
* sampling cadence is one sample per N ``new_page`` calls.

Env overrides are read into module constants at import time, so the
disabled-path contract is exercised in a subprocess that imports
``conftest`` fresh with ``FOLIPLUS_HEALTH_PROBE=0`` set.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import warnings
from collections.abc import Callable, Iterator
from pathlib import Path

import conftest
import pytest
from conftest import _Flaky95Probe, _is_chromium_process

TEST_DIR = Path(__file__).parent

# ``health-<YYYYMMDD>-<HHMMSS>-<worker>-<pid>.jsonl`` — the pid suffix is
# what keeps two rounds that start in the same second from interleaving.
LOG_NAME = re.compile(r"^health-\d{8}-\d{6}-gw0-\d+\.jsonl$")

EXPECTED_FIELDS = frozenset(
    {
        "ts",
        "worker",
        "pid",
        "mode",
        "rss_mb",
        "handles",
        "threads",
        "chromium_procs",
        "contexts",
        "pages_open",
        "pages_opened_total",
    }
)

_PROBE_SCRIPT = """\
import os
from pathlib import Path

import conftest

probe_dir = Path(os.environ["PROBE_DIR"])
conftest._HEALTH_DIR = probe_dir
probe = conftest._Flaky95Probe("gw0", int(os.environ["FOLIPLUS_HEALTH_SAMPLE_N"]))

class _Ctx:
    pages = [object()]

class _Browser:
    contexts = [_Ctx()] * 12

for _ in range(20):
    probe.maybe_sample(_Browser())
probe.close()

print(
    conftest._HEALTH_PROBE_ENABLED,
    conftest._HEALTH_SAMPLE_N,
    len(list(probe_dir.glob("health-*.jsonl"))),
    probe._pages_opened,
)
"""


class _FakeCtx:
    """Enough of a Playwright BrowserContext for the probe's snapshot."""

    def __init__(self, pages: int = 1) -> None:
        self.pages = [object() for _ in range(pages)]


class _FakeBrowser:
    """Enough of a Playwright Browser: the probe only touches ``.contexts``."""

    def __init__(
        self, contexts: list[_FakeCtx] | None = None, *, broken: bool = False
    ) -> None:
        self._contexts = contexts or []
        self._broken = broken

    @property
    def contexts(self) -> list[_FakeCtx]:
        if self._broken:
            raise RuntimeError("browser crashed")
        return list(self._contexts)


def _snap(**overrides: object) -> dict[str, object]:
    """A complete snapshot dict; override any metric per test."""
    snap: dict[str, object] = {
        "ts": 1_761_000_000.0,
        "worker": "gw0",
        "pid": os.getpid(),
        "mode": "per_page",
        "rss_mb": 100.0,
        "handles": 100,
        "threads": 8,
        "chromium_procs": 20,
        "contexts": 1,
        "pages_open": 1,
        "pages_opened_total": 1,
    }
    snap.update(overrides)
    return snap


def _snapshot_records(probe_dir: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(probe_dir.glob("health-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            records.append(json.loads(line))
    return records


@pytest.fixture(autouse=True)
def _only_browser_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    # The probe also measures the whole machine (rss, handles, Chromium
    # process count). Restricting it to browser-side metrics here keeps a
    # loaded dev box or a concurrent 24-worker round from tripping real
    # flaky-95 warnings inside these unit tests.
    monkeypatch.setattr(conftest, "_HEALTH_THRESHOLDS", {"contexts": 3})


@pytest.fixture
def probes() -> Iterator[list[_Flaky95Probe]]:
    created: list[_Flaky95Probe] = []
    yield created
    for probe in created:
        probe.close()


@pytest.fixture
def probe_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Enabled probe whose log dir is redirected into ``tmp_path``."""
    directory = tmp_path / "flaky95"
    monkeypatch.setattr(conftest, "_HEALTH_DIR", directory)
    monkeypatch.setattr(conftest, "_HEALTH_PROBE_ENABLED", True)
    return directory


@pytest.fixture
def make_probe(
    probes: list[_Flaky95Probe],
) -> Callable[..., _Flaky95Probe]:
    def _make(sample_n: int = 1, worker_id: str = "gw0") -> _Flaky95Probe:
        probe = _Flaky95Probe(worker_id, sample_n)
        probes.append(probe)
        return probe

    return _make


class TestThresholdWarnings:
    """Once-per-metric warnings, and only above the threshold."""

    def test_over_threshold_warns_once(self, make_probe, monkeypatch):
        monkeypatch.setattr(conftest, "_HEALTH_THRESHOLDS", {"contexts": 3})
        probe = make_probe()
        probe._snapshot = lambda browser: _snap(contexts=5)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            probe.maybe_sample(None)

        messages = [str(w.message) for w in caught if "[flaky-95]" in str(w.message)]
        assert len(messages) == 1
        message = messages[0]
        assert "[flaky-95] contexts=5 exceeds threshold 3" in message
        assert "worker=gw0" in message
        assert f"pid={os.getpid()}" in message
        assert "pages_opened_total=1" in message

    @pytest.mark.parametrize("contexts", [1, 2, 3])
    def test_at_and_below_threshold_is_quiet(self, make_probe, contexts):
        probe = make_probe()
        probe._snapshot = lambda browser: _snap(contexts=contexts)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            probe.maybe_sample(None)
        assert not caught

    def test_none_metric_is_ignored(self, make_probe):
        # psutil or the browser can fail mid-snapshot; a None value must be
        # skipped, not compared against a threshold.
        probe = make_probe()
        probe._snapshot = lambda browser: _snap(contexts=None, pages_open=None)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            probe.maybe_sample(None)
        assert not caught

    def test_repeated_over_threshold_samples_warn_once(self, make_probe):
        probe = make_probe()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for total in (1, 2, 3):
                probe._snapshot = lambda browser, total=total: _snap(
                    contexts=5, pages_opened_total=total
                )
                probe.maybe_sample(None)

        messages = [str(w.message) for w in caught if "[flaky-95]" in str(w.message)]
        assert len(messages) == 1
        assert "pages_opened_total=1" in messages[0]

    def test_each_metric_warns_once(self, make_probe, monkeypatch):
        monkeypatch.setattr(
            conftest, "_HEALTH_THRESHOLDS", {"contexts": 3, "handles": 10}
        )
        probe = make_probe()
        probe._snapshot = lambda browser: _snap(contexts=5, handles=100)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            probe.maybe_sample(None)
            probe.maybe_sample(None)

        messages = [str(w.message) for w in caught if "[flaky-95]" in str(w.message)]
        assert len(messages) == 2
        assert sum(1 for m in messages if "[flaky-95] contexts=" in m) == 1
        assert sum(1 for m in messages if "[flaky-95] handles=" in m) == 1

    def test_end_to_end_warns_and_logs(self, make_probe, probe_dir, monkeypatch):
        # Real snapshot path: a browser object in, warning plus record out.
        monkeypatch.setattr(conftest, "_HEALTH_THRESHOLDS", {"contexts": 3})
        probe = make_probe()
        browser = _FakeBrowser([_FakeCtx(1) for _ in range(4)])

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            probe.maybe_sample(browser)

        assert sum(1 for w in caught if "[flaky-95]" in str(w.message)) == 1
        records = _snapshot_records(probe_dir)
        assert records[0]["contexts"] == 4
        assert records[0]["pages_open"] == 4


class TestJsonlLog:
    """One JSON object per line, in the documented schema."""

    def test_writes_one_line_per_sample(self, make_probe, probe_dir):
        probe = make_probe()
        browser = _FakeBrowser([_FakeCtx(2)])
        for _ in range(3):
            probe.maybe_sample(browser)

        files = sorted(probe_dir.glob("health-*.jsonl"))
        assert len(files) == 1
        name = files[0].name
        assert LOG_NAME.match(name)
        assert name.endswith(f"-{os.getpid()}.jsonl")
        assert len(_snapshot_records(probe_dir)) == 3

    def test_line_is_a_single_json_object(self, make_probe, probe_dir):
        probe = make_probe()
        probe.maybe_sample(_FakeBrowser([_FakeCtx(2)]))

        (log,) = sorted(probe_dir.glob("health-*.jsonl"))
        lines = log.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert set(record) == EXPECTED_FIELDS

        assert record["worker"] == "gw0"
        assert record["pid"] == os.getpid()
        assert record["mode"] == conftest._BROWSER_MODE
        assert record["contexts"] == 1
        assert record["pages_open"] == 2
        assert record["pages_opened_total"] == 1
        assert isinstance(record["ts"], float)
        # psutil is optional, and platform-dependent (no ``num_handles`` on
        # Linux); magnitudes also depend on the machine — a runner with no
        # browser open reports ``chromium_procs`` of 0. Types are the
        # contract, so assert those.
        assert record["rss_mb"] is None or isinstance(record["rss_mb"], float)
        for field in ("handles", "threads", "chromium_procs"):
            assert record[field] is None or isinstance(record[field], int)


class TestInertBehavior:
    """The probe observes only: it never fails the test it observes."""

    def test_disabled_probe_logs_nothing_and_warns_nothing(
        self, tmp_path, monkeypatch, probes
    ):
        disabled_dir = tmp_path / "flaky95"
        monkeypatch.setattr(conftest, "_HEALTH_DIR", disabled_dir)
        monkeypatch.setattr(conftest, "_HEALTH_PROBE_ENABLED", False)
        probe = _Flaky95Probe("gw0", 1)
        probes.append(probe)
        assert probe._log_fh is None

        # 4 contexts would trip the contexts threshold; a disabled probe
        # must not sample or warn at all.
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                probe.maybe_sample(_FakeBrowser([_FakeCtx() for _ in range(4)]))

        assert not caught
        assert not disabled_dir.exists()
        assert probe._pages_opened == 3
        probe.close()  # nothing to close
        assert probe._log_fh is None

    def test_unopenable_log_stays_inert(self, probe_dir, probes, monkeypatch):
        # A failed open is swallowed: a locked file or full disk must not
        # abort the session fixture that constructed the probe.
        def _boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(Path, "open", _boom)
        probe = _Flaky95Probe("gw0", 1)
        probes.append(probe)
        assert probe._log_fh is None
        probe.maybe_sample(_FakeBrowser([_FakeCtx()]))  # no raise
        assert probe._pages_opened == 1

    def test_uncreatable_log_dir_stays_inert(self, probe_dir, probes, monkeypatch):
        # A failed mkdir is swallowed on the same path as a failed open: a
        # stray file at the log path or a read-only checkout must not abort
        # the session fixture that constructed the probe.
        def _boom(*args, **kwargs):
            raise OSError("permission denied")

        monkeypatch.setattr(Path, "mkdir", _boom)
        probe = _Flaky95Probe("gw0", 1)
        probes.append(probe)
        assert probe._log_fh is None

        # 4 contexts would trip the contexts threshold; a degraded probe
        # must stay quiet and keep counting.
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                probe.maybe_sample(_FakeBrowser([_FakeCtx() for _ in range(4)]))

        assert not caught
        assert not probe_dir.exists()
        assert probe._pages_opened == 3

    def test_write_failure_is_swallowed(self, make_probe):
        class _BrokenHandle:
            def write(self, _text):
                raise OSError("disk full")

            def close(self):
                raise OSError("disk full")

        probe = make_probe()
        probe._log_fh = _BrokenHandle()
        probe.maybe_sample(_FakeBrowser([_FakeCtx()]))  # write raises
        probe.close()  # close raises
        assert probe._log_fh is None

    def test_snapshot_failure_still_records_without_browser_metrics(
        self, make_probe, probe_dir
    ):
        probe = make_probe()
        probe.maybe_sample(_FakeBrowser(broken=True))  # no raise

        records = _snapshot_records(probe_dir)
        assert len(records) == 1
        assert records[0]["contexts"] is None
        assert records[0]["pages_open"] is None
        assert records[0]["worker"] == "gw0"


class TestSamplingCadence:
    """One sample per N ``new_page`` calls."""

    def test_one_sample_every_n_pages(self, make_probe, probe_dir):
        probe = make_probe(sample_n=3)
        browser = _FakeBrowser([_FakeCtx()])
        for _ in range(9):
            probe.maybe_sample(browser)

        records = _snapshot_records(probe_dir)
        assert [record["pages_opened_total"] for record in records] == [3, 6, 9]

    def test_pages_before_first_sample_are_not_logged(self, make_probe, probe_dir):
        probe = make_probe(sample_n=4)
        for _ in range(2):
            probe.maybe_sample(_FakeBrowser([_FakeCtx()]))

        assert probe._pages_opened == 2
        files = sorted(probe_dir.glob("health-*.jsonl"))
        assert len(files) == 1  # file is opened up front
        assert _snapshot_records(probe_dir) == []

    def test_sample_n_is_clamped_to_one(self, make_probe, probe_dir):
        probe = make_probe(sample_n=0)
        assert probe._sample_n == 1
        for _ in range(3):
            probe.maybe_sample(_FakeBrowser([_FakeCtx()]))
        assert len(_snapshot_records(probe_dir)) == 3


class TestEnvSwitch:
    """Env overrides are read at import time, so test them in a subprocess."""

    def test_health_probe_disabled_via_env(self, tmp_path):
        env = {
            **os.environ,
            "FOLIPLUS_HEALTH_PROBE": "0",
            "FOLIPLUS_HEALTH_SAMPLE_N": "7",
            "PYTHONPATH": str(TEST_DIR),
            "PROBE_DIR": str(tmp_path / "flaky95"),
        }
        result = subprocess.run(
            [sys.executable, "-c", _PROBE_SCRIPT],
            env=env,
            cwd=TEST_DIR,
            capture_output=True,
            text=True,
            timeout=60,
        )

        assert result.returncode == 0, result.stderr
        enabled, sample_n, files, pages = result.stdout.split()
        assert enabled == "False"
        assert sample_n == "7"
        assert files == "0"  # FOLIPLUS_HEALTH_PROBE=0 writes nothing
        assert pages == "20"  # counter still advances, sampling just stops


class TestChromiumFamily:
    """``chromium_procs`` must count the Chromium family on any platform."""

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("chrome.exe", True),
            ("Chrome.exe", True),
            ("chrome", True),
            ("chrome_crashpad_handler", True),
            ("headless_shell", True),
            ("chromium", True),
            ("chromium-browser", True),
            ("msedge.exe", False),
            ("firefox.exe", False),
            ("python.exe", False),
            ("", False),
            (None, False),
        ],
    )
    def test_is_chromium_process(self, name, expected):
        assert _is_chromium_process(name) is expected
