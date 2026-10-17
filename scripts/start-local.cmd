@echo off
rem Manual Builder local launcher (no Node needed; uses Windows PowerShell).
rem Browsers refuse file saves from file:// pages, so the editor is served at http://localhost instead.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1" %*
pause
