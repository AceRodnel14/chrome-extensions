# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.64.1"]
# ///
"""Smoke test for the Media Downloader extension, driven through the WSL test Chrome.

    uv run media-downloader/tools/smoke/smoke.py [--interactive] [--only SITE_OR_CASE_ID ...]

Cases live in cases.toml (next to this file). Logs go to logs/<date-time>/ (run.log, results.jsonl, screenshots).
Exit code: 0 all passed, 1 a case or health check failed, 2 setup problem. Nothing is ever deleted.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
import time
import tomllib
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Self
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
EXT_DIR = HERE.parents[1]  # media-downloader/
CASES_FILE = HERE / "cases.toml"
LOGS_DIR = HERE / "logs"
CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
CDP_URL = f"http://{CDP_HOST}:{CDP_PORT}"
PROFILE_DIR = Path.home() / ".mediadownloader-chrome-profile"
EXPECTED_EXT_ID = "cedeopcefllcjmmkopihgkkngehmfmmk"
DOWNLOADS = Path.home() / "Downloads"

SITE_FOLDERS = {
    "instagram": "instagram.com",
    "x": "x.com",
    "youtube": "youtube.com",
    "reddit": "reddit.com",
    "rednote": "rednote.com",
    "naver-blog": "blog.naver.com",
    "naver-entertain": "entertain.naver.com",
}
SITE_DOMAINS = SITE_FOLDERS
DIAGNOSE_FILES = {
    "instagram": "diagnose.js",
    "x": "diagnose-x.js",
    "youtube": "diagnose-youtube.js",
    "reddit": "diagnose-reddit.js",
    "rednote": "diagnose-rednote.js",
    "naver-blog": "diagnose-naver-blog.js",
    "naver-entertain": "diagnose-naver-entertain.js",
}
CASE_KEYS = {
    "id",
    "site",
    "url",
    "interactive",
    "prompt",
    "kind",
    "index",
    "expect_count",
    "expect_ext",
    "timeout_s",
    "diagnose",
}
LOGIN_RE = re.compile(
    r"/(accounts/login|i/flow/login|login|signin|sign_in)\b|accounts\.google\.com",
    re.IGNORECASE,
)

log = logging.getLogger("smoke")


class CaseError(ValueError):
    """A bad entry in cases.toml; the message names the case id."""


@dataclass
class Case:
    id: str
    site: str
    kind: str
    url: str | None = None
    interactive: bool = False
    prompt: str = ""
    index: int = 0
    expect_count: int | None = None
    expect_ext: list[str] = field(default_factory=list)
    timeout_s: float = 60.0
    diagnose: bool = False


@dataclass
class Toast:
    kind: str  # progress | success | warning | error | unknown
    count: int | None  # N, the number of files the click covered
    text: str
    color: str = ""


# ---------------------------------------------------------------- pure helpers (unit-tested)


def _check(cond: bool, cid: str, msg: str) -> None:
    if not cond:
        raise CaseError(f"case {cid!r}: {msg}")


def parse_case(raw: dict[str, Any], position: int) -> Case:
    cid = raw.get("id")
    if not isinstance(cid, str) or not cid.strip():
        raise CaseError(f"case #{position}: missing or empty id")
    unknown = set(raw) - CASE_KEYS
    _check(not unknown, cid, f"unknown field(s) {sorted(unknown)}")
    site = raw.get("site")
    _check(
        site in SITE_FOLDERS,
        cid,
        f"site must be one of {sorted(SITE_FOLDERS)}, got {site!r}",
    )
    interactive = raw.get("interactive", False)
    _check(isinstance(interactive, bool), cid, "interactive must be true or false")
    url = raw.get("url")
    prompt = raw.get("prompt", "")
    if interactive:
        _check(
            isinstance(prompt, str) and prompt.strip() != "",
            cid,
            "interactive cases need a prompt",
        )
    else:
        _check(
            isinstance(url, str) and urlparse(url).scheme in ("http", "https"),
            cid,
            "needs an http(s) url",
        )
    kind = raw.get("kind", "post" if site == "reddit" else None)
    _check(isinstance(kind, str) and kind != "", cid, "kind is required")
    _check(
        site != "reddit" or kind == "post", cid, 'reddit cases always use kind "post"'
    )
    index = raw.get("index", 0)
    _check(
        isinstance(index, int) and not isinstance(index, bool) and index >= 0,
        cid,
        "index must be an integer >= 0",
    )
    count = raw.get("expect_count")
    _check(
        count is None
        or (isinstance(count, int) and not isinstance(count, bool) and count >= 1),
        cid,
        "expect_count must be an integer >= 1",
    )
    ext = raw.get("expect_ext", [])
    _check(
        isinstance(ext, list) and all(isinstance(e, str) and e for e in ext),
        cid,
        "expect_ext must be a list of strings",
    )
    timeout = raw.get("timeout_s", 60)
    _check(
        isinstance(timeout, (int, float))
        and not isinstance(timeout, bool)
        and timeout > 0,
        cid,
        "timeout_s must be > 0",
    )
    diagnose = raw.get("diagnose", False)
    _check(isinstance(diagnose, bool), cid, "diagnose must be true or false")
    return Case(
        id=cid,
        site=site,
        kind=kind,
        url=url if isinstance(url, str) else None,
        interactive=interactive,
        prompt=prompt if isinstance(prompt, str) else "",
        index=index,
        expect_count=count,
        expect_ext=[e.lower().lstrip(".") for e in ext],
        timeout_s=float(timeout),
        diagnose=diagnose,
    )


def load_cases(path: Path) -> list[Case]:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as err:
        raise CaseError(f"cannot read {path}: {err}") from err
    raws = data.get("case", [])
    if not isinstance(raws, list) or not raws:
        raise CaseError(f"{path}: no [[case]] entries")
    cases = [parse_case(r, i + 1) for i, r in enumerate(raws)]
    seen: set[str] = set()
    diag_sites: set[str] = set()
    for c in cases:
        _check(c.id not in seen, c.id, "duplicate id")
        seen.add(c.id)
        if c.diagnose:
            _check(
                c.site not in diag_sites,
                c.id,
                f"second diagnose=true case for site {c.site}",
            )
            diag_sites.add(c.site)
    return cases


def select_cases(cases: list[Case], only: list[str]) -> list[Case]:
    """--only values (already split on commas) match a site or a case id."""
    if not only:
        return cases
    known = {c.id for c in cases} | {c.site for c in cases}
    unknown = [o for o in only if o not in known]
    if unknown:
        raise CaseError(
            f"--only: no site or case id named {unknown}; known: {sorted(known)}"
        )
    return [c for c in cases if c.id in only or c.site in only]


def split_only(values: list[str] | None) -> list[str]:
    return [p.strip() for v in values or [] for p in v.split(",") if p.strip()]


def parse_toast(text: str, color: str = "") -> Toast:
    """Classify the extension's toast (shared/report.js) by its text; the colour is the fallback."""
    t = " ".join(text.split())
    if t.startswith("Downloading"):
        return Toast("progress", _first_int(t), t, color)
    if m := re.match(r"Only (\d+) of (\d+) files? saved\.", t):
        return Toast("error", int(m.group(2)), t, color)
    if m := re.match(r"Saved (\d+) of (\d+) files\.", t):
        kind = "warning" if "not set:" in t else "success"
        return Toast(kind, int(m.group(2)), t, color)
    if t.startswith("Saved "):
        return Toast("warning" if "not set:" in t else "success", 1, t, color)
    return Toast(_kind_from_color(color), None, t, color)


def _first_int(text: str) -> int | None:
    m = re.search(r"\d+", text)
    return int(m.group()) if m else None


def _kind_from_color(color: str) -> str:
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", color)
    if not m:
        return "unknown"
    r, g, b = (int(x) for x in m.groups())
    if r > 150 and g < 90 and b < 90:
        return "error"
    if r > 150 and 80 <= g <= 140 and b < 60:
        return "warning"
    if g > r and g > b:
        return "success"
    return "unknown"


def is_final(toast: Toast) -> bool:
    return toast.kind in ("success", "warning", "error")


def snapshot(folder: Path) -> dict[str, tuple[int, int]]:
    """name -> (size, mtime_ns) of the regular files directly in folder (empty if it doesn't exist yet)."""
    snap: dict[str, tuple[int, int]] = {}
    if folder.is_dir():
        for p in folder.iterdir():
            if p.is_file():
                st = p.stat()
                snap[p.name] = (st.st_size, st.st_mtime_ns)
    return snap


def new_files(
    before: dict[str, tuple[int, int]], after: dict[str, tuple[int, int]]
) -> list[tuple[str, int]]:
    """Files that are new or changed since `before`, ignoring unfinished .crdownload files."""
    return sorted(
        (name, info[0])
        for name, info in after.items()
        if before.get(name) != info and not name.endswith(".crdownload")
    )


def check_files(case: Case, toast: Toast, files: list[tuple[str, int]]) -> str | None:
    """Return a failure message, or None when the new files match the case's expectations."""
    want = case.expect_count if case.expect_count is not None else toast.count
    if want is not None and len(files) != want:
        return f"expected {want} new file(s), found {len(files)}"
    if not files:
        return "no new files"
    empty = [n for n, size in files if size <= 0]
    if empty:
        return f"empty file(s): {empty}"
    if case.expect_ext:
        bad = [
            n
            for n, _ in files
            if Path(n).suffix.lower().lstrip(".") not in case.expect_ext
        ]
        if bad:
            return f"unexpected extension(s) {bad}; allowed {case.expect_ext}"
    return None


def is_login_url(url: str) -> bool:
    return bool(LOGIN_RE.search(url))


def pick_button_frame(frames: list[Any], selector: str, index: int) -> Any | None:
    """First frame (the main frame comes first in page.frames) that holds more than `index` buttons, else None.

    Single-frame sites always answer with the main frame. Naver Blog's desktop post lives in iframe#mainFrame.
    """
    for frame in frames:
        try:
            if frame.locator(selector).count() > index:
                return frame
        except Exception:  # a frame that is navigating away
            log.debug("frame not searchable", exc_info=True)
    return None


# ---------------------------------------------------------------- results log


class Results:
    """results.jsonl: one JSON object per line, flushed immediately."""

    def __init__(self, path: Path, run_id: str) -> None:
        self.run_id = run_id
        self.case_id = ""
        self._fh = path.open("a", encoding="utf-8")

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self._fh.close()

    def write(self, type_: str, **fields: Any) -> None:
        rec = {
            "type": type_,
            "run_id": self.run_id,
            "case_id": self.case_id,
            "ts": datetime.now().isoformat(),
            **fields,
        }
        self._fh.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
        self._fh.flush()


# ---------------------------------------------------------------- browser


def cdp_up() -> bool:
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as r:
            return r.status == 200
    except (OSError, urllib.error.URLError):
        return False


def ensure_chrome() -> None:
    if cdp_up():
        log.info("Chrome already listening on %s; using it (never restarted)", CDP_URL)
        return
    cmd = [
        "google-chrome",
        f"--user-data-dir={PROFILE_DIR}",
        f"--remote-debugging-port={CDP_PORT}",
        f"--remote-debugging-address={CDP_HOST}",
        "--enable-unsafe-extension-debugging",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    log.info("Starting Chrome: %s", " ".join(cmd))
    try:
        subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as err:
        raise SetupError(f"cannot start google-chrome: {err}") from err
    for _ in range(60):
        if cdp_up():
            log.info("Chrome is up")
            return
        time.sleep(0.5)
    raise SetupError(
        f"Chrome did not open {CDP_URL} within 30 s. If a Chrome with profile {PROFILE_DIR} is already running "
        "without --remote-debugging-port, close it and run again."
    )


class SetupError(RuntimeError):
    """Chrome or the extension could not be set up (exit code 2)."""


def classify_console(msg_type: str, text: str) -> dict[str, Any]:
    return {
        "level": msg_type,
        "text": text,
        "mediadownloader": "mediadownloader" in text.lower(),
    }


def run_cases(
    cases: list[Case], interactive_all: bool, results: Results, shot_dir: Path
) -> list[dict[str, Any]]:
    from playwright.sync_api import sync_playwright

    outcomes: list[dict[str, Any]] = []
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.connect_over_cdp(CDP_URL)
        except Exception as err:
            raise SetupError(f"cannot connect to Chrome over CDP: {err}") from err
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        cdp = browser.new_browser_cdp_session()
        try:
            cdp.send("Browser.setDownloadBehavior", {"behavior": "default"})
            ext = cdp.send("Extensions.loadUnpacked", {"path": str(EXT_DIR)})
        except Exception as err:
            raise SetupError(
                f"Extensions.loadUnpacked failed for {EXT_DIR}: {err}"
            ) from err
        ext_id = ext.get("id", "?")
        log.info("Extension loaded, id %s", ext_id)
        if ext_id != EXPECTED_EXT_ID:
            log.warning("Extension id is %s, expected %s", ext_id, EXPECTED_EXT_ID)
        results.write("setup", extension_id=ext_id, extension_path=str(EXT_DIR))

        def on_console(msg: Any) -> None:
            try:
                results.write(
                    "console",
                    url=msg.page.url if msg.page else None,
                    **classify_console(msg.type, msg.text),
                )
            except Exception:
                log.debug("console capture failed", exc_info=True)

        context.on("console", on_console)
        context.on(
            "weberror",
            lambda e: results.write(
                "page_error",
                text=str(e.error),
                mediadownloader="mediadownloader" in str(e.error).lower(),
            ),
        )
        try:  # worker console lines (needs a recent Playwright); the brief allows dropping this
            for w in context.service_workers:
                w.on("console", on_console)
            context.on("serviceworker", lambda w: w.on("console", on_console))
        except Exception:
            log.debug("service worker console capture unavailable", exc_info=True)

        for case in cases:
            results.case_id = case.id
            outcomes.append(run_case(case, interactive_all, context, results, shot_dir))
        results.case_id = ""
    return outcomes


def host_matches(url: str, domain: str) -> bool:
    host = urlparse(url).hostname or ""
    return host == domain or host.endswith("." + domain)


def refresh_pages(context: Any) -> list[Any]:
    """context.pages after letting Playwright process pending browser events.

    The sync API only handles events (new tabs, navigations) while one of its calls runs, so after a blocking input()
    the list is stale and a tab the user just opened is missing. A short wait on an existing page pumps them.
    """
    for _ in range(5):
        count = len(context.pages)
        try:
            if context.pages:
                context.pages[0].wait_for_timeout(300)
            else:
                time.sleep(0.3)
        except Exception:
            log.debug("could not pump browser events", exc_info=True)
        if len(context.pages) == count:
            break
    return list(context.pages)


def pick_tab(context: Any, site: str, seen: list[tuple[Any, str]]) -> Any:
    """The tab the user just opened for an interactive case, only ever among tabs on the site's domain.

    `seen` is [(page, url)] recorded before the prompt. Preference: a tab that is new since then (the most recently
    opened), else one whose URL changed, else the only candidate. Several candidates or none: SetupError listing them,
    never a guess, so the runner cannot click in a tab that might be the user's own.
    """
    tabs = [
        p for p in refresh_pages(context) if host_matches(p.url, SITE_DOMAINS[site])
    ]
    known = {id(p): url for p, url in seen}
    new = [p for p in tabs if id(p) not in known]
    changed = [p for p in tabs if id(p) in known and known[id(p)] != p.url]
    for group in (new, changed):
        if group:
            return group[-1]
    if len(tabs) == 1:
        return tabs[0]
    listing = ", ".join(p.url for p in tabs) or "none"
    raise SetupError(
        f"cannot tell which tab to test on {SITE_DOMAINS[site]} "
        f"(candidates: {listing}); open the page in a new tab and retry"
    )


TOAST_JS = """() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.style && d.style.zIndex === '2147483000');
  return el ? { text: el.textContent || '', color: getComputedStyle(el).backgroundColor } : null;
}"""


def read_toast(page: Any) -> Toast | None:
    """`page` is the page or the frame that holds the buttons (the toast is drawn there)."""
    got = page.evaluate(TOAST_JS)
    return parse_toast(got["text"], got["color"]) if got and got["text"] else None


def run_diagnose(page: Any, case: Case, results: Results) -> bool:
    """Run the site's tools/diagnose*.js in the page (or the frame with the post); log each row. Returns True when no row FAILed."""
    src = (
        (EXT_DIR / "tools" / DIAGNOSE_FILES[case.site])
        .read_text(encoding="utf-8")
        .strip()
        .rstrip(";")
    )
    ok = True
    try:
        rows = page.evaluate(src)
    except Exception as err:  # noqa: BLE001
        log.error("[%s] diagnose script failed: %s", case.id, err)
        results.write(
            "diagnose",
            site=case.site,
            check="(script)",
            result="FAIL",
            detail=str(err)[:300],
        )
        return False
    for row in rows or []:
        res = row.get("result")
        log.info(
            "[%s] diagnose %-5s %s %s",
            case.id,
            res,
            row.get("check"),
            row.get("detail", ""),
        )
        results.write(
            "diagnose",
            site=case.site,
            check=row.get("check"),
            result=res,
            detail=row.get("detail", ""),
        )
        ok = ok and res != "FAIL"
    return ok


def run_case(
    case: Case, interactive_all: bool, context: Any, results: Results, shot_dir: Path
) -> dict[str, Any]:
    from playwright.sync_api import TimeoutError as PWTimeout

    start = time.monotonic()
    out: dict[str, Any] = {"case": case, "status": "FAIL", "diagnose_ok": None}
    page = None
    opened_by_us = False
    toast: Toast | None = None
    files: list[tuple[str, int]] = []
    error = tb = None
    folder = DOWNLOADS / SITE_FOLDERS[case.site]
    log.info("=== case %s (%s, kind=%s) ===", case.id, case.site, case.kind)
    try:
        before = snapshot(folder)
        if case.interactive or interactive_all:
            seen = [
                (p, p.url) for p in refresh_pages(context)
            ]  # events pumped: see refresh_pages
            log.info(case.prompt or f"Open the {case.site} page to test ({case.url}).")
            input("Press Enter when the page is ready... ")
            page = pick_tab(context, case.site, seen)
            log.info("[%s] attached to tab %s", case.id, page.url)
        else:
            assert case.url
            page = context.new_page()
            opened_by_us = True
            page.goto(
                case.url, wait_until="domcontentloaded", timeout=case.timeout_s * 1000
            )
            log.info("[%s] opened %s -> %s", case.id, case.url, page.url)
        if is_login_url(page.url):
            raise RuntimeError(f"not logged in (redirected to {page.url})")
        page.bring_to_front()  # background tabs don't lazy-load the badges
        sel = f'.md-download-btn[data-md-kind="{case.kind}"]'
        # The frame that holds the buttons: the page's main frame, or for Naver Blog's desktop post its iframe.
        scope = None
        btn_deadline = time.monotonic() + case.timeout_s
        while scope is None:
            scope = pick_button_frame(page.frames, sel, case.index)
            if scope is None:
                if time.monotonic() >= btn_deadline:
                    if is_login_url(page.url):
                        raise RuntimeError(f"not logged in (redirected to {page.url})")
                    raise RuntimeError(
                        f"no button {sel} (index {case.index}) within {case.timeout_s:g} s"
                    )
                time.sleep(0.25)
        if scope is not page.main_frame:
            log.info("[%s] buttons are in frame %s", case.id, scope.url)
        btn = scope.locator(sel).nth(case.index)
        if case.diagnose:
            out["diagnose_ok"] = run_diagnose(scope, case, results)
        scope.evaluate(
            "() => document.querySelectorAll('div').forEach(d => {"
            " if (d.style.zIndex === '2147483000') d.textContent = '' })"
        )
        btn.scroll_into_view_if_needed(timeout=10000)
        try:  # overlays can swallow the click until the tile is hovered
            btn.locator("xpath=..").hover(timeout=5000)
            btn.click(timeout=5000)
        except PWTimeout:
            log.warning(
                "[%s] click blocked by an overlay; dispatching the click in the page",
                case.id,
            )
            btn.evaluate("el => el.click()")
        log.info("[%s] clicked %s", case.id, sel)
        deadline = time.monotonic() + case.timeout_s
        while time.monotonic() < deadline:
            t = read_toast(scope)
            if t and is_final(t):
                toast = t
                break
            time.sleep(0.5)
        if toast is None:
            raise RuntimeError(f"no final toast within {case.timeout_s:g} s")
        log.info("[%s] toast (%s): %s", case.id, toast.kind, toast.text)
        while any(folder.glob("*.crdownload")) and time.monotonic() < deadline + 30:
            time.sleep(0.5)
        files = [(str(folder / n), s) for n, s in new_files(before, snapshot(folder))]
        for path, size in files:
            log.info("[%s] new file %s (%d bytes)", case.id, path, size)
        if toast.kind == "error":
            raise RuntimeError(f"extension reported an error: {toast.text}")
        problem = check_files(case, toast, [(Path(p).name, s) for p, s in files])
        if problem:
            raise RuntimeError(problem)
        out["status"] = "PASS"
        if toast.kind == "warning":
            log.warning("[%s] PASS with note: %s", case.id, toast.text)
    except SetupError:
        raise  # exit code 2: the run cannot go on
    except Exception as err:
        error = str(err) or type(err).__name__
        if not isinstance(err, (RuntimeError, PWTimeout)):
            tb = traceback.format_exc()
        log.error("[%s] FAIL: %s", case.id, error, exc_info=bool(tb))
        if page is not None:
            try:
                shot = shot_dir / f"{case.id}.png"
                page.screenshot(path=str(shot))
                log.info("[%s] screenshot %s", case.id, shot)
            except Exception:
                log.debug("screenshot failed", exc_info=True)
    finally:
        if opened_by_us and page is not None:
            try:
                page.close()
            except Exception:
                log.debug("tab close failed", exc_info=True)
    out["nfiles"] = len(files)
    out["duration_s"] = round(time.monotonic() - start, 1)
    out["toast"] = toast
    results.write(
        "case",
        site=case.site,
        status=out["status"],
        toast_kind=toast.kind if toast else None,
        toast_text=toast.text if toast else None,
        new_files=[{"path": p, "size": s} for p, s in files],
        duration_s=out["duration_s"],
        error=error,
        traceback=tb,
    )
    return out


# ---------------------------------------------------------------- main


def setup_logging(run_dir: Path) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")
    log.setLevel(logging.DEBUG)
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)
    fh = logging.FileHandler(run_dir / "run.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    log.addHandler(console)
    log.addHandler(fh)


def summary_table(outcomes: list[dict[str, Any]]) -> list[str]:
    lines = [f"{'case':<28}{'status':<8}{'toast':<9}{'files':<6}{'secs':<7}diagnose"]
    for o in outcomes:
        c: Case = o["case"]
        t: Toast | None = o["toast"]
        diag = (
            "-"
            if not c.diagnose
            else (
                "-"
                if o["diagnose_ok"] is None
                else ("ok" if o["diagnose_ok"] else "FAIL")
            )
        )
        lines.append(
            f"{c.id:<28}{o['status']:<8}{(t.kind if t else '-'):<9}{o['nfiles']:<6}{o['duration_s']:<7}{diag}"
        )
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Media Downloader smoke test (see cases.toml)"
    )
    ap.add_argument(
        "--interactive",
        action="store_true",
        help="pause before every selected case so you open the page yourself",
    )
    ap.add_argument(
        "--only",
        action="append",
        metavar="SITE_OR_CASE",
        help="run only this site or case id (repeatable, or comma-separated)",
    )
    args = ap.parse_args(argv)

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = LOGS_DIR / run_id
    shot_dir = run_dir / "screenshots"
    shot_dir.mkdir(parents=True, exist_ok=True)
    setup_logging(run_dir)
    log.info("run %s, logs in %s", run_id, run_dir)
    with Results(run_dir / "results.jsonl", run_id) as results:
        return run_main(args, run_dir, shot_dir, results)


def run_main(
    args: argparse.Namespace, run_dir: Path, shot_dir: Path, results: Results
) -> int:
    try:
        cases = select_cases(load_cases(CASES_FILE), split_only(args.only))
        ensure_chrome()
        outcomes = run_cases(cases, args.interactive, results, shot_dir)
    except (CaseError, SetupError) as err:
        log.error("setup error: %s", err)
        results.write("setup_error", error=str(err))
        log.info("logs: %s", run_dir)
        return 2
    except Exception as err:
        log.exception("unexpected error")
        results.write("setup_error", error=str(err), traceback=traceback.format_exc())
        log.info("logs: %s", run_dir)
        return 2

    failed = [o for o in outcomes if o["status"] != "PASS" or o["diagnose_ok"] is False]
    for line in summary_table(outcomes):
        log.info(line)
    log.info("%d case(s), %d failed. Logs: %s", len(outcomes), len(failed), run_dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
