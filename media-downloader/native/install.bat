@echo off
rem Registers the exiftool helper with Google Chrome, Microsoft Edge, Brave and Chromium for the current Windows user.
rem Each browser looks for helpers under its own registry key, so all four are written.
rem   install.bat            register
rem   install.bat uninstall  remove the registration
rem Needs Python 3 (https://www.python.org, tick "Add python.exe to PATH" or use the "py" launcher).
rem Keep this folder where it is: Chrome runs the helper from here. Run install.bat again if you move it.
setlocal

set "HOST_NAME=com.mediadownloader.exiftool"
set "EXTENSION_ID=cedeopcefllcjmmkopihgkkngehmfmmk"
set "HERE=%~dp0"
set "MANIFEST=%HERE%%HOST_NAME%.json"
set "CHROME_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"
set "EDGE_KEY=HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%"
set "BRAVE_KEY=HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\%HOST_NAME%"
set "CHROMIUM_KEY=HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%"

if /i "%~1"=="uninstall" (
  reg delete "%CHROME_KEY%" /f >nul 2>nul
  reg delete "%EDGE_KEY%" /f >nul 2>nul
  reg delete "%BRAVE_KEY%" /f >nul 2>nul
  reg delete "%CHROMIUM_KEY%" /f >nul 2>nul
  del "%MANIFEST%" >nul 2>nul
  echo Removed the mediadownloader exiftool helper registration.
  goto :end
)

where py >nul 2>nul || where python >nul 2>nul || (
  echo Python 3 was not found. Install it from https://www.python.org and run install.bat again.
  goto :end
)

rem JSON needs every backslash doubled.
set "HELPER=%HERE%mediadownloader_exiftool.bat"
set "HELPER_JSON=%HELPER:\=\\%"

(
  echo {
  echo   "name": "%HOST_NAME%",
  echo   "description": "mediadownloader exiftool helper: writes the post date into downloaded photos and videos",
  echo   "path": "%HELPER_JSON%",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EXTENSION_ID%/"]
  echo }
) > "%MANIFEST%"

reg add "%CHROME_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
reg add "%EDGE_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
reg add "%BRAVE_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
reg add "%CHROMIUM_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
echo Registered %HOST_NAME% for Chrome, Edge, Brave and Chromium:
echo   %MANIFEST%
echo Restart the browser if it was open, then use Settings ^> Test in mediadownloader.

:end
endlocal
pause
