"""Unit tests for the pure helpers in smoke.py (no browser). Run with PYTHONDONTWRITEBYTECODE=1 -p no:cacheprovider."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_path = Path(__file__).with_name("smoke.py")
_spec = importlib.util.spec_from_file_location("smoke", _path)
assert _spec and _spec.loader
smoke = importlib.util.module_from_spec(_spec)
sys.modules["smoke"] = smoke
_spec.loader.exec_module(smoke)


def write_cases(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "cases.toml"
    p.write_text(body, encoding="utf-8")
    return p


def test_shipped_cases_are_valid() -> None:
    cases = smoke.load_cases(smoke.CASES_FILE)
    assert {c.site for c in cases} == set(smoke.SITE_FOLDERS)
    assert all(
        (smoke.EXT_DIR / "tools" / smoke.DIAGNOSE_FILES[c.site]).is_file()
        for c in cases
        if c.diagnose
    )


def test_load_defaults(tmp_path: Path) -> None:
    p = write_cases(
        tmp_path,
        '[[case]]\nid="a"\nsite="reddit"\nurl="https://www.reddit.com/r/pics/"\n',
    )
    (c,) = smoke.load_cases(p)
    assert (c.kind, c.index, c.timeout_s, c.expect_count, c.diagnose) == (
        "post",
        0,
        60.0,
        None,
        False,
    )


@pytest.mark.parametrize(
    "body",
    [
        '[[case]]\nid="bad"\nsite="tiktok"\nurl="https://x.com"\nkind="post"\n',
        '[[case]]\nid="bad"\nsite="x"\nkind="post"\n',  # no url
        '[[case]]\nid="bad"\nsite="x"\ninteractive=true\nkind="post"\n',  # no prompt
        '[[case]]\nid="bad"\nsite="x"\nurl="https://x.com"\n',  # no kind
        '[[case]]\nid="bad"\nsite="reddit"\nurl="https://reddit.com"\nkind="tile"\n',
        '[[case]]\nid="bad"\nsite="x"\nurl="https://x.com"\nkind="post"\nindex=-1\n',
        '[[case]]\nid="bad"\nsite="x"\nurl="https://x.com"\nkind="post"\nbogus=1\n',
    ],
)
def test_invalid_case_names_id(tmp_path: Path, body: str) -> None:
    with pytest.raises(smoke.CaseError, match="bad"):
        smoke.load_cases(write_cases(tmp_path, body))


def test_duplicate_id_and_second_diagnose(tmp_path: Path) -> None:
    one = '[[case]]\nid="a"\nsite="x"\nurl="https://x.com"\nkind="post"\n'
    with pytest.raises(smoke.CaseError, match="duplicate"):
        smoke.load_cases(write_cases(tmp_path, one + one))
    d = '[[case]]\nid="%s"\nsite="x"\nurl="https://x.com"\nkind="post"\ndiagnose=true\n'
    with pytest.raises(smoke.CaseError, match="second diagnose"):
        smoke.load_cases(write_cases(tmp_path, d % "a" + d % "b"))


def test_select_and_split() -> None:
    cases = smoke.load_cases(smoke.CASES_FILE)
    assert smoke.split_only(["x, youtube", "reddit-pics"]) == [
        "x",
        "youtube",
        "reddit-pics",
    ]
    assert {c.site for c in smoke.select_cases(cases, ["youtube"])} == {"youtube"}
    assert [c.id for c in smoke.select_cases(cases, ["reddit-pics"])] == ["reddit-pics"]
    with pytest.raises(smoke.CaseError):
        smoke.select_cases(cases, ["nope"])


@pytest.mark.parametrize(
    ("text", "kind", "count"),
    [
        ("Saved alice_instagram_20240101.jpg.", "success", 1),
        ("Saved 3 of 3 files.", "success", 3),
        ("Saved 3 of 3 files. Dates set on 3.", "success", 3),
        ("Saved a.jpg. Dates set on 0 of 1; not set: a.jpg: boom", "warning", 1),
        (
            "Saved 2 of 2 files. Dates set on 1 of 2; not set: b.mp4: boom (and 1 more)",
            "warning",
            2,
        ),
        ("Only 1 of 3 files saved. Failed: a.jpg: HTTP 403 (and 1 more)", "error", 3),
        ("Downloading 2 files…", "progress", 2),
        ("Downloading…", "progress", None),
        ("something else", "unknown", None),
    ],
)
def test_parse_toast(text: str, kind: str, count: int | None) -> None:
    t = smoke.parse_toast(text)
    assert (t.kind, t.count) == (kind, count)


def test_toast_colour_fallback() -> None:
    assert smoke.parse_toast("???", "rgb(204, 0, 0)").kind == "error"
    assert smoke.parse_toast("???", "rgb(178, 106, 0)").kind == "warning"
    assert smoke.parse_toast("???", "rgb(43, 166, 64)").kind == "success"
    assert smoke.is_final(smoke.parse_toast("Saved 2 of 2 files."))
    assert not smoke.is_final(smoke.parse_toast("Downloading 2 files…"))


def test_new_files_diff(tmp_path: Path) -> None:
    (tmp_path / "old.jpg").write_bytes(b"x")
    before = smoke.snapshot(tmp_path)
    (tmp_path / "new.mp4").write_bytes(b"abc")
    (tmp_path / "part.mp4.crdownload").write_bytes(b"z")
    assert smoke.new_files(before, smoke.snapshot(tmp_path)) == [("new.mp4", 3)]
    assert smoke.snapshot(tmp_path / "missing") == {}


def test_check_files() -> None:
    case = smoke.Case(id="c", site="x", kind="post", expect_ext=["jpg"])
    toast = smoke.parse_toast("Saved 2 of 2 files.")
    assert smoke.check_files(case, toast, [("a.jpg", 5), ("b.jpg", 5)]) is None
    assert "expected 2" in smoke.check_files(case, toast, [("a.jpg", 5)])
    assert "empty" in smoke.check_files(case, toast, [("a.jpg", 5), ("b.jpg", 0)])
    assert "extension" in smoke.check_files(case, toast, [("a.jpg", 5), ("b.mp4", 5)])
    case.expect_count = 1
    assert smoke.check_files(case, toast, [("a.jpg", 5)]) is None


def test_login_and_console() -> None:
    assert smoke.is_login_url("https://www.instagram.com/accounts/login/?next=/")
    assert smoke.is_login_url("https://x.com/i/flow/login")
    assert not smoke.is_login_url("https://x.com/NASA/media")
    assert (
        smoke.classify_console("log", "mediadownloader: hi")["mediadownloader"] is True
    )
    assert smoke.classify_console("log", "other")["mediadownloader"] is False


def test_host_matches() -> None:
    assert smoke.host_matches("https://www.x.com/NASA", "x.com")
    assert smoke.host_matches("https://x.com/", "x.com")
    assert not smoke.host_matches("https://netflix.com/", "x.com")
