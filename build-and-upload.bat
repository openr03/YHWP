@echo off
REM ───────────────────────────────────────────────────────────
REM YHWP 빌드 + GitHub release 자동 업로드
REM
REM 사전 준비:
REM   1) build-windows.bat 의 사전 준비 항목 모두 완료
REM   2) gh CLI 인증:  gh auth login
REM
REM 실행: 더블클릭
REM ───────────────────────────────────────────────────────────

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo  YHWP 빌드 + Release 업로드
echo ============================================================
echo.

REM gh 인증 확인
gh auth status >nul 2>&1
if errorlevel 1 (
  echo [ERROR] gh CLI 가 인증되어 있지 않습니다.
  echo   먼저 한 번만:  gh auth login
  pause
  exit /b 1
)

REM ── 빌드 단계 (build-windows.bat 의 1~4 단계 그대로) ──
echo [1/5] git pull
call git pull
if errorlevel 1 goto :fail

echo.
echo [2/5] pnpm install
call pnpm install --frozen-lockfile
if errorlevel 1 goto :fail

echo.
echo [3/5] studio-host 빌드
call pnpm --filter @golbin/hop-studio-host build
if errorlevel 1 goto :fail

echo.
echo [4/5] Tauri MSI 빌드  (5~10분 소요)
call pnpm --filter hop-desktop tauri build --bundles msi
if errorlevel 1 goto :fail

REM ── 업로드 ──
echo.
echo [5/5] release 업로드
set MSI_DIR=apps\desktop\src-tauri\target\release\bundle\msi

REM Tauri 가 만든 파일을 사이트가 기대하는 stable name 으로 복사
set FOUND=
for %%f in ("%MSI_DIR%\YHWP_*.msi") do set FOUND=%%f

if "%FOUND%"=="" (
  echo [ERROR] %MSI_DIR% 에 YHWP_*.msi 가 없습니다. 빌드 실패 가능성.
  pause
  exit /b 1
)

echo   원본:  %FOUND%
copy /Y "%FOUND%" "YHWP-windows-x64.msi" >nul

echo   업로드: YHWP-windows-x64.msi
gh release upload v0.1.10-yhwp YHWP-windows-x64.msi --clobber --repo openr03/YHWP
if errorlevel 1 (
  echo [ERROR] release 업로드 실패. 토큰 권한/네트워크 확인.
  del YHWP-windows-x64.msi 2>nul
  pause
  exit /b 1
)

del YHWP-windows-x64.msi 2>nul

echo.
echo ============================================================
echo  업로드 완료. https://hwp.youngsam.net 에서 즉시 사용 가능
echo  Release: https://github.com/openr03/YHWP/releases/tag/v0.1.10-yhwp
echo ============================================================
pause
exit /b 0

:fail
echo.
echo [ERROR] 단계 실패. 위 로그 확인.
pause
exit /b 1
