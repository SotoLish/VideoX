@echo off
setlocal EnableDelayedExpansion

set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_HOME=C:\Users\1\Android"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%PATH%"

echo [1/3] 同步 Capacitor...
cd /d "C:\Users\1\WorkBuddy\2026-05-31-13-56-58\video-player-apk"
call npx cap sync android

echo.
echo [2/3] 检查 Android SDK...
call sdkmanager --version 2>&1 | findstr /i "version" && echo SDK OK || echo 正在安装 SDK 组件...
call sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" --silent 2>&1

echo.
echo [3/3] 构建 APK...
cd android
call gradlew.bat assembleDebug --no-daemon -Dorg.gradle.java.home="%JAVA_HOME%" 2>&1
set BUILD_RESULT=%ERRORLEVEL%

echo.
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo ============================================
    echo    构建成功！
    echo    APK: android\app\build\outputs\apk\debug\app-debug.apk
    echo ============================================
) else (
    echo [ERROR] 构建失败，错误码: %BUILD_RESULT%
)
pause
