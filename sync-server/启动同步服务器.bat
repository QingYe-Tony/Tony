@echo off
chcp 65001 >nul
title 通用收银台 · 同步服务器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 Node.js。请先安装：
  echo     官网 https://nodejs.org  下载 LTS 版本，一路下一步即可
  echo.
  echo   装好后关闭本窗口，重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动同步服务器…
echo.
node server.js

echo.
echo   服务器已停止。
pause
