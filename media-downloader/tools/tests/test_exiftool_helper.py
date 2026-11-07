import importlib.util
import json
import os
import shutil
import struct
import subprocess
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HELPER = Path(__file__).resolve().parents[2] / "native" / "mediadownloader_exiftool.py"
spec = importlib.util.spec_from_file_location("mdhelper", HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

TAKEN = 1794038400  # 2026-11-07 08:00:00 UTC
PLUS8 = timezone(timedelta(hours=8))
MP4_SRC = (
    Path(os.environ["EXIFTOOL_TEST_MP4"])
    if os.environ.get("EXIFTOOL_TEST_MP4")
    else None
)


def test_local_stamp_zones():
    assert helper.local_stamp(TAKEN, PLUS8) == ("2026:11:07 16:00:00+08:00", "+08:00")
    assert helper.local_stamp(TAKEN, timezone.utc) == (
        "2026:11:07 08:00:00+00:00",
        "+00:00",
    )
    stamp, off = helper.local_stamp(TAKEN, timezone(timedelta(hours=-5)))
    assert (stamp, off) == ("2026:11:07 03:00:00-05:00", "-05:00")
    assert helper.local_stamp(TAKEN)[0].endswith(helper.local_stamp(TAKEN)[1])


def fake_run(captured, stdout, stderr=""):
    def run(command, **kwargs):
        argfile = command[command.index("-@") + 1]
        captured["command"] = command
        captured["args"] = Path(argfile).read_text(encoding="utf-8").splitlines()
        return subprocess.CompletedProcess(command, 0, stdout, stderr)

    return run


def test_argfile_blocks(monkeypatch):
    captured = {}
    out = "    1 image files updated\n=md= 0\n    1 image files updated\n=md= 1\n"
    monkeypatch.setattr(helper, "run", fake_run(captured, out))
    files = [{"path": "/a.jpg", "takenAt": TAKEN}, {"path": "/b.mp4", "takenAt": TAKEN}]
    results = helper.set_dates(["exiftool"], files, PLUS8)
    assert [r["ok"] for r in results] == [True, True]
    args = captured["args"]
    assert args.count("QuickTimeUTC=1") == 2  # exiftool resets options at each -execute
    assert "-DateTimeOriginal" not in " ".join(args)
    assert args.count("-execute") == 1
    ts = "2026:11:07 16:00:00+08:00"
    block = [
        "-m",
        "-overwrite_original",
        "-api",
        "QuickTimeUTC=1",
        f"-AllDates={ts}",
        f"-CreationTime={ts}",
        f"-ModifyDate={ts}",
        "-OffsetTime*=+08:00",
        f"-TrackCreateDate={ts}",
        f"-TrackModifyDate={ts}",
        f"-MediaCreateDate={ts}",
        f"-MediaModifyDate={ts}",
        f"-FileModifyDate={ts}",
        "-echo3",
        "=md= 0",
        "-echo4",
        "=md= 0",
        "/a.jpg",
    ]
    assert args[: len(block)] == block
    assert args[len(block)] == "-execute"
    assert args[-1] == "/b.mp4"


def test_warning_still_ok(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        helper,
        "run",
        fake_run(
            captured,
            "    1 image files updated\n=md= 0\n",
            "Warning: [minor] Something odd\n=md= 0\n",
        ),
    )
    res = helper.set_dates(["exiftool"], [{"path": "/a.png", "takenAt": TAKEN}], PLUS8)
    assert res == [{"path": "/a.png", "ok": True, "error": None}]


def png_bytes():
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = zlib.compress(b"\x00\xff\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", raw)
        + chunk(b"IEND", b"")
    )


JPG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd0ffd9"
)


@pytest.mark.skipif(not os.environ.get("EXIFTOOL_DIR"), reason="EXIFTOOL_DIR not set")
def test_integration(tmp_path):
    command = helper.find_exiftool(os.environ["EXIFTOOL_DIR"])
    files = {"a.jpg": JPG, "b.png": png_bytes()}
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    names = list(files)
    if MP4_SRC and MP4_SRC.is_file():
        shutil.copy(MP4_SRC, tmp_path / "c.mp4")
        names.append("c.mp4")
    items = [{"path": str(tmp_path / n), "takenAt": TAKEN} for n in names]
    results = helper.set_dates(command, items, PLUS8)
    assert [r["ok"] for r in results] == [True] * len(names), results

    for name in names:
        out = subprocess.run(
            command + ["-json", "-G1", "-a", "-time:all", str(tmp_path / name)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        tags = json.loads(out)[0]
        fmd = datetime.strptime(tags["System:FileModifyDate"], "%Y:%m:%d %H:%M:%S%z")
        assert fmd.timestamp() == TAKEN, name
        if name.endswith(".mp4"):
            dates = {
                k: v
                for k, v in tags.items()
                if k.split(":")[0]
                in ("QuickTime", "Track1", "Track2", "Media1", "Media2")
            }
            assert dates
            for key in ("QuickTime:CreateDate", "QuickTime:ModifyDate"):
                assert tags[key].startswith("2026:11:07 08:00:00"), key
            for key, value in dates.items():
                assert "0000:00:00" not in str(value), key
                if "Date" in key:
                    assert str(value).startswith("2026:11:07 08:00:00"), (key, value)
        else:
            joined = json.dumps(tags)
            assert "2026:11:07 16:00:00" in joined
            for key, value in tags.items():
                if key.endswith(("DateTimeOriginal", "CreateDate")) and key.startswith(
                    ("ExifIFD", "XMP", "IFD0")
                ):
                    assert str(value).startswith("2026:11:07 16:00:00"), (key, value)
            if name.endswith(".jpg"):
                assert tags["ExifIFD:OffsetTimeOriginal"] == "+08:00"
                assert tags["ExifIFD:DateTimeOriginal"].startswith(
                    "2026:11:07 16:00:00"
                )
