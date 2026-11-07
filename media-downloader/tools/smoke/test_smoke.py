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


def test_naver_blog_site_tables() -> None:
    assert smoke.SITE_FOLDERS["naver-blog"] == "blog.naver.com"
    assert smoke.DIAGNOSE_FILES["naver-blog"] == "diagnose-naver-blog.js"
    assert (smoke.EXT_DIR / "tools" / "diagnose-naver-blog.js").is_file()
    # both hosts of the site count as its tab (pick_tab uses host_matches with the folder name)
    assert smoke.host_matches("https://blog.naver.com/id/1", "blog.naver.com")
    assert smoke.host_matches("https://m.blog.naver.com/id/1", "blog.naver.com")
    assert not smoke.host_matches("https://cafe.naver.com/", "blog.naver.com")


def test_naver_blog_cases() -> None:
    cases = {c.id: c for c in smoke.load_cases(smoke.CASES_FILE)}
    desktop, mobile = cases["naver-blog-desktop"], cases["naver-blog-mobile"]
    for c in (desktop, mobile):
        assert (c.site, c.kind, c.interactive, c.expect_ext) == (
            "naver-blog",
            "image",
            True,
            ["jpg", "png"],
        )
        assert c.url is None  # never a specific blog
    assert desktop.diagnose and not mobile.diagnose  # one diagnose case per site


def test_naver_entertain_site_tables() -> None:
    assert smoke.SITE_FOLDERS["naver-entertain"] == "entertain.naver.com"
    assert smoke.DIAGNOSE_FILES["naver-entertain"] == "diagnose-naver-entertain.js"
    assert (smoke.EXT_DIR / "tools" / "diagnose-naver-entertain.js").is_file()
    # the mobile host (the only one the extension matches) and the desktop host both count as the site's tab
    assert smoke.host_matches(
        "https://m.entertain.naver.com/home/article/1/2", "entertain.naver.com"
    )
    assert smoke.host_matches("https://entertain.naver.com/home", "entertain.naver.com")
    assert not smoke.host_matches("https://blog.naver.com/id/1", "entertain.naver.com")
    assert not smoke.host_matches(
        "https://notentertain.naver.com/", "entertain.naver.com"
    )


def test_naver_entertain_cases() -> None:
    cases = {c.id: c for c in smoke.load_cases(smoke.CASES_FILE)}
    article = cases["naver-entertain-article"]
    photo = cases["naver-entertain-photo-article"]
    viewer = cases["naver-entertain-viewer"]
    for c, kind in ((article, "image"), (photo, "image"), (viewer, "viewer")):
        assert (c.site, c.kind, c.interactive, c.expect_count, c.expect_ext) == (
            "naver-entertain",
            kind,
            True,
            1,
            ["jpg", "png"],
        )
        assert c.url is None  # never a specific article
    assert article.diagnose and not photo.diagnose and not viewer.diagnose


class FakeTab:
    def __init__(self, url: str) -> None:
        self.url = url
        self.on_wait: list[
            FakeTab
        ] = []  # tabs that only appear once an event is pumped
        self.ctx: FakeContext | None = None

    def wait_for_timeout(self, ms: int) -> None:
        assert self.ctx is not None
        self.ctx.pages.extend(self.on_wait)
        self.on_wait = []


class FakeContext:
    def __init__(self, *pages: FakeTab) -> None:
        self.pages = list(pages)
        for p in pages:
            p.ctx = self


def seen_of(context: FakeContext) -> list[tuple[FakeTab, str]]:
    return [(p, p.url) for p in context.pages]


def test_pick_tab() -> None:
    url = "https://m.entertain.naver.com/home/article/1/2"
    users = FakeTab(url)  # the user's own tab, same URL as the one the case opens
    blog = FakeTab("https://blog.naver.com/id/1")
    ctx = FakeContext(users, blog)
    seen = seen_of(ctx)
    new = FakeTab(url)
    ctx.pages.append(new)
    other = FakeTab("https://example.com/")
    ctx.pages.append(other)
    # a new tab on the site wins over an old one with the same URL; other sites never count
    assert smoke.pick_tab(ctx, "naver-entertain", seen) is new
    # several new tabs: the most recently opened
    newer = FakeTab(url + "?x")
    ctx.pages.append(newer)
    assert smoke.pick_tab(ctx, "naver-entertain", seen) is newer


def test_pick_tab_pumps_events_for_tabs_opened_during_the_prompt() -> None:
    # Playwright's sync API only sees a new tab while one of its calls runs: after input() it is missing until
    # a call (wait_for_timeout) pumps the events. pick_tab must do that before choosing.
    url = "https://m.entertain.naver.com/home/article/1/2"
    users = FakeTab(url)
    ctx = FakeContext(users)
    seen = seen_of(ctx)
    new = FakeTab(url)
    new.ctx = ctx
    users.on_wait = [new]
    assert smoke.pick_tab(ctx, "naver-entertain", seen) is new


def test_pick_tab_changed_url_or_single_candidate() -> None:
    a = FakeTab("https://m.entertain.naver.com/photo")
    b = FakeTab("https://m.entertain.naver.com/home")
    ctx = FakeContext(a, b)
    seen = seen_of(ctx)
    b.url = (
        "https://m.entertain.naver.com/home/article/1/2"  # navigated since the prompt
    )
    assert smoke.pick_tab(ctx, "naver-entertain", seen) is b
    # no new or changed tab, one candidate: it is used
    only = FakeContext(a, FakeTab("https://example.com/"))
    assert smoke.pick_tab(only, "naver-entertain", seen_of(only)) is a


def test_pick_tab_refuses_to_guess() -> None:
    a = FakeTab("https://m.entertain.naver.com/photo")
    b = FakeTab("https://m.entertain.naver.com/home")
    ctx = FakeContext(a, b)
    with pytest.raises(smoke.SetupError) as err:
        smoke.pick_tab(ctx, "naver-entertain", seen_of(ctx))
    assert a.url in str(err.value) and b.url in str(err.value)
    none = FakeContext(FakeTab("https://blog.naver.com/id/1"))
    with pytest.raises(smoke.SetupError):
        smoke.pick_tab(none, "naver-entertain", seen_of(none))


class FakeFrame:
    def __init__(self, count: int = 0, fail: bool = False) -> None:
        self._count, self._fail = count, fail

    def locator(self, selector: str) -> FakeFrame:
        self.selector = selector
        return self

    def count(self) -> int:
        if self._fail:
            raise RuntimeError("frame detached")
        return self._count


def test_pick_button_frame() -> None:
    sel = '.md-download-btn[data-md-kind="image"]'
    main, post, other = FakeFrame(0), FakeFrame(5), FakeFrame(2)
    assert (
        smoke.pick_button_frame([main, post, other], sel, 3) is post
    )  # desktop: the iframe
    assert smoke.pick_button_frame([main, post, other], sel, 0) is post
    assert (
        smoke.pick_button_frame([main, post, other], sel, 5) is None
    )  # no 6th button anywhere
    assert post.selector == sel


def test_pick_button_frame_single_frame_sites_use_the_main_frame() -> None:
    main = FakeFrame(3)
    assert smoke.pick_button_frame([main], "x", 2) is main
    assert smoke.pick_button_frame([main], "x", 3) is None
    # the main frame wins when frames in a page both hold buttons
    assert smoke.pick_button_frame([main, FakeFrame(9)], "x", 1) is main


def test_pick_button_frame_skips_a_broken_frame() -> None:
    good = FakeFrame(1)
    assert smoke.pick_button_frame([FakeFrame(fail=True), good], "x", 0) is good
