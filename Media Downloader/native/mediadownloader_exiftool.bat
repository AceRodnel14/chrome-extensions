@echo off
rem Chrome on Windows cannot start a .py file directly; it starts this, which runs the helper with Python.
rem Prefers the "py" launcher (python.org installs), else "python" on PATH.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0mediadownloader_exiftool.py" %*
) else (
  python "%~dp0mediadownloader_exiftool.py" %*
)
