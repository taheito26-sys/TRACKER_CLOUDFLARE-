@echo off
setlocal
node "%~dp0run-phase1-oneshot.mjs" %*
exit /b %ERRORLEVEL%
