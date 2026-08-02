@echo off
chcp 65001 >nul
title Luma Agency - نظام الإدارة
cd /d "%~dp0"

echo.
echo  ============================================
echo    نظام إدارة وكالة لوما - التشغيل المحلي
echo  ============================================
echo.
echo   العنوان:        http://localhost:5000/?emulator=1
echo   اسم المستخدم:   admin
echo.
echo   جارٍ تشغيل الخادم... انتظر قليلاً.
echo   لا تغلق هذه النافذة أثناء استخدام النظام.
echo.

if not exist "emulator-data" mkdir "emulator-data"

REM يفتح المتصفح بعد أن يجهز الخادم
start "" cmd /c "timeout /t 14 /nobreak >nul & start http://localhost:5000/?emulator=1"

firebase emulators:start --project luma-web-d3550 --import ./emulator-data --export-on-exit ./emulator-data

REM ---------------------------------------------------------------------------
REM  إنقاذ الحفظ التلقائي.
REM  على ويندوز يفشل Firebase أحياناً في الخطوة الأخيرة من الحفظ (إعادة تسمية
REM  المجلد) بسبب قفل الملفات أو مزامنة OneDrive، فتبقى البيانات كاملة داخل
REM  مجلد مؤقت باسم firebase-export-*. هنا ننقلها إلى مكانها الصحيح.
REM ---------------------------------------------------------------------------
echo.
echo   جارٍ حفظ البيانات...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = $PWD.Path;" ^
  "$tmp = Get-ChildItem -Directory -Filter 'firebase-export-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
  "if ($tmp -and (Test-Path (Join-Path $tmp.FullName 'firebase-export-metadata.json'))) {" ^
  "  $t = Join-Path $base 'emulator-data';" ^
  "  if (Test-Path $t) { Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue };" ^
  "  Move-Item $tmp.FullName $t -Force;" ^
  "  Write-Host '   تم حفظ البيانات بنجاح.' -ForegroundColor Green" ^
  "} else { Write-Host '   البيانات محفوظة.' -ForegroundColor Green };" ^
  "Get-ChildItem -Directory -Filter 'firebase-export-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"

echo.
echo   تم إيقاف النظام. بياناتك محفوظة وستعود عند التشغيل القادم.
echo.
pause
