@echo off
setlocal
set "PYTHONUTF8=1"
rem pushd supports both ordinary folders and UNC paths such as WSL shares.
pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto folder_error
py -3 -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 goto use_py
python -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 goto use_python
python3 -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 goto use_python3
echo Python 3.9 or later is required. Install Python, then run this file again.
popd
pause
exit /b 1
:use_py
py -3 -X utf8 launch.py %*
goto finished
:use_python
python -X utf8 launch.py %*
goto finished
:use_python3
python3 -X utf8 launch.py %*
goto finished
:finished
set "launch_result=%errorlevel%"
popd
if not "%launch_result%"=="0" pause
exit /b %launch_result%
:folder_error
echo Cannot open the app folder. Keep this file inside RayOpticsLab.
pause
exit /b 1
