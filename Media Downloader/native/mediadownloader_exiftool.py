#!/usr/bin/env python3
"""mediadownloader exiftool helper (Chrome native messaging host).

Chrome starts this script when the extension calls chrome.runtime.sendNativeMessage(
"com.mediadownloader.exiftool", message). It reads one message from stdin, answers on stdout and exits.
Messages are JSON, each prefixed with its length as a 4-byte native-endian integer.

Messages:
  {"action": "version", "exiftoolDir": "..."}
      -> {"ok": true, "version": "13.59", "exiftool": "<command used>"}
  {"action": "setDates", "exiftoolDir": "...", "files": [{"path": "...", "takenAt": 1761305247}, ...]}
      -> {"ok": true, "results": [{"path": "...", "ok": true, "error": null}, ...]}
Errors: {"ok": false, "error": "..."}

setDates writes the post time (takenAt, Unix seconds) to every file with one exiftool run, using the same tags
and format as the original Python script: no time zone, the UTC clock time that is also in the filename.

Works on Windows (started through mediadownloader_exiftool.bat) and Linux/macOS (started directly).
Standard library only.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

MARKER = "=md="  # exiftool argument files treat lines starting with "#" as comments, so no "#" here
WINDOWS = os.name == "nt"


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack("=I", raw_length)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(message):
    data = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def find_exiftool(exiftool_dir):
    """Return the command (list) that runs exiftool from the given folder, or raise with what was looked for."""
    if not exiftool_dir:
        raise RuntimeError("No exiftool folder is set in mediadownloader's Settings.")
    path = os.path.expanduser(exiftool_dir.strip())
    if os.path.isfile(path):  # the exiftool file itself was given instead of its folder
        folder, names = os.path.dirname(path), [os.path.basename(path)]
    elif os.path.isdir(path):
        folder, names = path, (["exiftool.exe", "exiftool"] if WINDOWS else ["exiftool"])
    else:
        raise RuntimeError(f"The exiftool folder does not exist: {path}")

    for name in names:
        candidate = os.path.join(folder, name)
        if not os.path.isfile(candidate):
            continue
        if candidate.lower().endswith(".exe"):
            return [candidate]
        # The Perl distribution's "exiftool" is a Perl script, often without the executable bit: run it with perl.
        perl = shutil.which("perl")
        if not perl:
            raise RuntimeError(f"Found {candidate}, but it needs Perl and perl is not installed "
                               "(Debian/Ubuntu: sudo apt install perl-base; on Windows use exiftool.exe instead).")
        return [perl, candidate]

    if os.path.isfile(os.path.join(folder, "exiftool(-k).exe")):
        raise RuntimeError(f'Found "exiftool(-k).exe" in {folder}. Rename it to "exiftool.exe" '
                           "(the -k version waits for a key press and would never finish).")
    raise RuntimeError(f"No exiftool found in {folder} (looked for {', '.join(names)}).")


def run(command, **kwargs):
    # CREATE_NO_WINDOW: no console window flashes up on Windows.
    flags = subprocess.CREATE_NO_WINDOW if WINDOWS else 0
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          creationflags=flags, **kwargs)


def exif_timestamp(taken_at):
    # Same format as the original script; the UTC clock time, matching createdDate in the filename.
    return datetime.fromtimestamp(int(taken_at), tz=timezone.utc).strftime("%Y:%m:%d %H:%M:%S")


def set_dates(command, files):
    """One exiftool run for all files; per-file output is split by echo markers."""
    lines = []
    for index, item in enumerate(files):
        ts = exif_timestamp(item["takenAt"])
        lines += [
            "-overwrite_original",
            f"-DateTimeOriginal={ts}",
            f"-AllDates={ts}",
            f"-CreationTime={ts}",
            f"-ModifyDate={ts}",
            "-echo3", f"{MARKER} {index}",  # printed to stdout after this file
            "-echo4", f"{MARKER} {index}",  # printed to stderr after this file
            item["path"],
        ]
        if index < len(files) - 1:
            lines.append("-execute")

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".args", delete=False) as argfile:
        argfile.write("\n".join(lines) + "\n")
    try:
        result = run(command + ["-charset", "filename=utf8", "-@", argfile.name])
    finally:
        os.unlink(argfile.name)

    def split(text):
        blocks, current = [], []
        for line in text.splitlines():
            if line.startswith(MARKER):
                blocks.append(current)
                current = []
            else:
                current.append(line.strip())
        return blocks

    out_blocks, err_blocks = split(result.stdout), split(result.stderr)
    results = []
    for index, item in enumerate(files):
        out = out_blocks[index] if index < len(out_blocks) else []
        err = err_blocks[index] if index < len(err_blocks) else []
        errors = [line for line in err if line.startswith("Error")]
        updated = any("files updated" in line and not line.startswith("0") for line in out) or \
            any("files unchanged" in line and not line.startswith("0") for line in out)
        ok = updated and not errors
        if ok:
            error = None
        elif errors:
            error = "; ".join(errors)
        else:
            error = "; ".join(out + err) or result.stderr.strip()[:300] or "exiftool did not update the file"
        results.append({"path": item["path"], "ok": ok, "error": error})
    return results


def handle(message):
    command = find_exiftool(message.get("exiftoolDir", ""))
    action = message.get("action")
    if action == "version":
        result = run(command + ["-ver"])
        if result.returncode != 0:
            raise RuntimeError(f"exiftool did not run: {result.stderr.strip() or result.stdout.strip()}")
        return {"ok": True, "version": result.stdout.strip(), "exiftool": " ".join(command)}
    if action == "setDates":
        files = [f for f in message.get("files", []) if f.get("path") and f.get("takenAt")]
        if not files:
            return {"ok": True, "results": []}
        return {"ok": True, "results": set_dates(command, files)}
    raise RuntimeError(f"Unknown action: {action}")


def main():
    try:
        message = read_message()
        if message is None:
            return
        send_message(handle(message))
    except Exception as err:  # every failure goes back to the extension instead of a silent exit
        send_message({"ok": False, "error": str(err)})


if __name__ == "__main__":
    main()
