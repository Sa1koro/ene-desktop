@echo off
rem Double-click to build release\ENE.exe, a standalone ENE you can run directly.
rem Needs Rust and the Visual Studio C++ build tools (see README).
call "%~dp0start.bat" build %*
if not errorlevel 1 pause
