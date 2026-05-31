@echo off
echo ============================================
echo   VideoX APK Build Script
echo ============================================
echo.

REM 检查 Java 是否安装
java -version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 未找到 Java! 请先安装 JDK 17+
    echo         下载地址: https://adoptium.net/
    pause
    exit /b 1
)

REM 检查 Android SDK
if "%ANDROID_HOME%"=="" (
    echo [WARNING] ANDROID_HOME 未设置，尝试默认路径...
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
    ) else if exist "C:\Android\Sdk" (
        set ANDROID_HOME=C:\Android\Sdk
    ) else (
        echo [ERROR] 未找到 Android SDK! 请先安装 Android Studio
        echo         下载地址: https://developer.android.com/studio
        pause
        exit /b 1
    )
)

echo [1/4] 检查环境...
echo   Java: 
java -version 2>&1 | findstr /i "version"
echo   Android SDK: %ANDROID_HOME%
echo.

echo [2/4] 安装 npm 依赖...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install 失败!
    pause
    exit /b 1
)
echo.

echo [3/4] 同步 Capacitor...
call npx cap sync android
if %ERRORLEVEL% neq 0 (
    echo [ERROR] cap sync 失败!
    pause
    exit /b 1
)
echo.

echo [4/4] 构建 APK...
cd android
call gradlew assembleDebug
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 构建失败!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ============================================
echo   构建成功!
echo   APK 位置: android\app\build\outputs\apk\debug\app-debug.apk
echo ============================================
echo.
echo 将 app-debug.apk 拷贝到手机即可安装。
pause
