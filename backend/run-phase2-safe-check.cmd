@echo off
setlocal
node "%~dp0run-phase2-safe-check.mjs" %*
exit /b %ERRORLEVEL%
