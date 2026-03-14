@echo off
set BASE_URL=%1
if "%BASE_URL%"=="" set BASE_URL=https://p2p-tracker.taheito26.workers.dev
node "%~dp0scripts\verify-system-endpoints.mjs" --base-url "%BASE_URL%"
