@echo off
set DB_NAME=%1
if "%DB_NAME%"=="" set DB_NAME=crypto-tracker
set BASE_URL=%2
if "%BASE_URL%"=="" set BASE_URL=https://p2p-tracker.taheito26.workers.dev
powershell -ExecutionPolicy Bypass -File "%~dp0run-phase1-oneshot.ps1" -DbName "%DB_NAME%" -BaseUrl "%BASE_URL%"
if errorlevel 1 exit /b %ERRORLEVEL%
