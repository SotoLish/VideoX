@echo off
REM VideoX APK 一键构建脚本（Windows）
REM 使用方法：双击运行 或 命令行执行

echo ============================================
echo   VideoX APK Build Script
echo ============================================
echo.

set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_HOME=C:\Users\1\Android"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"

echo [1/4] 检查环境...
java -version 2>&1 | findstr /i "version"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Java 未找到: %JAVA_HOME%
    pause
    exit /b 1
)
echo   Android SDK: %ANDROID_HOME%
echo.

echo [2/4] 安装 Android SDK 组件（首次需要联网）...
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" 2>&1 | findstr /i "done\|Install\|Accept"
echo.

echo [3/4] 同步 Capacitor 项目...
call npm install
call npx cap sync android
echo.

echo [4/4] 开始构建 APK...
cd android
call gradlew.bat assembleDebug --no-daemon -Dorg.gradle.java.home="%JAVA_HOME%"
cd ..

if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    echo.
    echo ============================================
    echo    构建成功!
    echo    APK 位置:
    echo    android\app\build\outputs\apk\debug\app-debug.apk
    echo ============================================
    echo.
    echo 将 app-debug.apk 拷贝到手机即可安装。
) else (
    echo.
    echo [ERROR] 构建失败，请检查错误信息。
)
pause
