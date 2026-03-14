@echo off
setlocal
node "%~dp0run-phase3-safe-check.mjs" %*
exit /b %ERRORLEVEL%
