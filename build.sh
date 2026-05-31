#!/bin/bash
echo "============================================"
echo "  VideoX APK Build Script"
echo "============================================"
echo ""

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "[ERROR] 未找到 Java! 请先安装 JDK 17+"
    echo "        下载: https://adoptium.net/"
    exit 1
fi

# 检查 Android SDK
if [ -z "$ANDROID_HOME" ]; then
    echo "[WARNING] ANDROID_HOME 未设置，尝试默认路径..."
    if [ -d "$HOME/Library/Android/sdk" ]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    else
        echo "[ERROR] 未找到 Android SDK! 请先安装 Android Studio"
        echo "        下载: https://developer.android.com/studio"
        exit 1
    fi
fi

echo "[1/4] 检查环境..."
echo "  Java: $(java -version 2>&1 | head -1)"
echo "  Android SDK: $ANDROID_HOME"
echo ""

echo "[2/4] 安装 npm 依赖..."
npm install
echo ""

echo "[3/4] 同步 Capacitor..."
npx cap sync android
echo ""

echo "[4/4] 构建 APK..."
cd android && ./gradlew assembleDebug
cd ..

echo ""
echo "============================================"
echo "  构建成功!"
echo "  APK: android/app/build/outputs/apk/debug/app-debug.apk"
echo "============================================"
