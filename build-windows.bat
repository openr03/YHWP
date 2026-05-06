@echo off
REM ───────────────────────────────────────────────────────────
REM YHWP Windows 자동 빌드 스크립트
REM 더블클릭하면 git pull → 의존성 동기화 → 빌드 → 결과 폴더 열기
REM
REM 사전 준비 (한 번만):
REM   winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
REM   winget install Rustlang.Rustup
REM   winget install OpenJS.NodeJS.LTS
REM   winget install Git.Git
REM   corepack enable
REM   corepack prepare pnpm@10.33.0 --activate
REM   rustup default stable
REM ───────────────────────────────────────────────────────────

REM cmd 코드페이지를 UTF-8 로 — 이 파일이 UTF-8 로 저장돼있어서 한글 깨짐 방지
chcp 65001 >nul 2>&1

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo  YHWP Windows 빌드  ^|  %DATE% %TIME:~0,8%
echo ============================================================
echo.

REM git "dubious ownership" 자동 등록 — 폴더 소유자가 다를 때 git 이 거부하는 문제
REM 이미 등록돼 있으면 no-op. 빌드폴더 통째로 옮기거나 새로 클론할 때마다 재등록 안 해도 됨.
for /f "tokens=*" %%i in ('cd') do set CURDIR_FWD=%%i
set CURDIR_FWD=!CURDIR_FWD:\=/!
git config --global --add safe.directory "!CURDIR_FWD!" >nul 2>&1

echo [1/4] git pull + submodule  (최신 코드 + third_party/rhwp 동기화)
call git pull
if errorlevel 1 goto :gitfail
call git submodule update --init --recursive
if errorlevel 1 goto :gitfail

echo.
echo [2/4] pnpm install  (의존성)
call pnpm install --frozen-lockfile
if errorlevel 1 goto :pnpmfail

echo.
echo [3/4] studio-host 빌드  (프론트엔드)
call pnpm --filter @golbin/hop-studio-host build
if errorlevel 1 goto :feFail

echo.
echo [4/4] Tauri MSI 빌드  (5~10분 소요)
call pnpm --filter hop-desktop tauri build --bundles msi
if errorlevel 1 goto :tauriFail

echo.
echo ============================================================
echo  빌드 완료
echo ============================================================
set OUT_DIR=apps\desktop\src-tauri\target\release\bundle\msi

echo.
echo 결과물:
dir /B "%OUT_DIR%\*.msi" 2>nul
echo.
echo 폴더 열기: %OUT_DIR%
start "" explorer "%OUT_DIR%"

echo.
echo Tip: release 에 업로드하려면 build-and-upload.bat 사용
echo.
pause
exit /b 0

:gitfail
echo.
echo [ERROR] git pull 실패. 로컬 변경사항 충돌 가능성. `git status` 확인.
pause
exit /b 1

:pnpmfail
echo.
echo [ERROR] pnpm install 실패. PowerShell ExecutionPolicy 또는 네트워크 확인.
pause
exit /b 1

:feFail
echo.
echo [ERROR] 프론트엔드 빌드 실패. 위 로그 확인.
pause
exit /b 1

:tauriFail
echo.
echo [ERROR] Tauri 빌드 실패. 흔한 원인:
echo   - VS Build Tools (C++ workload) 미설치
echo   - WebView2 SDK 미동기화
echo   - rustup target 누락
echo 위 로그 확인.
pause
exit /b 1
