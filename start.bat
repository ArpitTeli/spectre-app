@echo off
title SPECTRE C2
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

echo Starting SPECTRE C2...
call npm start
