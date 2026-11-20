@echo off
rem QA gate for an exported mp4: flash check + audio/video sync check.
rem check_sync.py needs librosa + numpy; on this machine they live in .pydeps
rem (pip install --target, untracked - see .gitignore). Without it the gate fails
rem at "import librosa", so we point PYTHONPATH there instead of asking for a venv.
rem
rem   tools\check.cmd                       -> out\preview_1080p60.mp4
rem   tools\check.cmd out\<file>.mp4
setlocal
set "ROOT=%~dp0.."
set "PYTHONPATH=%ROOT%\.pydeps;%PYTHONPATH%"
if "%NUMBA_CACHE_DIR%"=="" set "NUMBA_CACHE_DIR=%TEMP%\numba"
set "MP4=%~1"
if "%MP4%"=="" set "MP4=out\preview_1080p60.mp4"
pushd "%ROOT%"
echo [check] flash: %MP4%
python "tools\check_flash.py" "%MP4%"
if errorlevel 1 goto fail
echo [check] sync:  %MP4%
python "tools\check_sync.py" "%MP4%"
if errorlevel 1 goto fail
popd
echo [check] PASS
exit /b 0
:fail
popd
echo [check] FAIL
exit /b 1
