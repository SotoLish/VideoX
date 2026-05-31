package com.givemesix.videox;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import com.givemesix.videox.player.VideoXPlayerPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * VideoX 主 Activity — Capacitor Bridge + 外部视频 Intent 处理
 *
 * 核心改进（v2.1）：
 * - 使用 addJavascriptInterface 替代 evaluateJavascript，100% 可靠
 * - 从 content:// URI 解析真实路径，跳过文件复制（快速路径）
 * - 仅在无法解析时才复制到缓存（兜底路径）
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "VideoX";

    // --- 外部视频待处理数据（由 JS 端轮询读取）---
    private volatile String pendingVideoPath = null;
    private volatile String pendingVideoName = null;

    // ==================== Android ↔ JS 桥接 ====================

    /**
     * 通过 addJavascriptInterface 注入，页面加载后立即可用。
     * 比 evaluateJavascript 可靠 100 倍。
     */
    public class VideoXJsBridge {
        @JavascriptInterface
        public String getPendingVideoPath() {
            String p = pendingVideoPath;
            return (p != null) ? p : "";
        }

        @JavascriptInterface
        public String getPendingVideoName() {
            String n = pendingVideoName;
            return (n != null) ? n : "";
        }
    }

    // ==================== 生命周期 ====================

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VideoXPlayerPlugin.class);

        // 在 super.onCreate 之前处理 Intent（捕获 URI）
        final Uri videoUri = extractVideoUri(getIntent());
        super.onCreate(savedInstanceState);

        // 将 JS 桥注入 WebView（必须在 super.onCreate 之后，WebView 已创建）
        injectJsBridge();

        // 处理外部视频（快速路径：解析真实路径；慢速路径：复制到缓存）
        if (videoUri != null) {
            Log.i(TAG, "检测到外部视频 URI: " + videoUri);
            resolveAndPrepareVideo(videoUri);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri videoUri = extractVideoUri(intent);
        if (videoUri == null) return;

        Log.i(TAG, "热启动外部视频 URI: " + videoUri);
        resolveAndPrepareVideo(videoUri);
    }

    // ==================== 工具：提取视频 URI ====================

    private Uri extractVideoUri(Intent intent) {
        if (intent == null) return null;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        return intent.getData();
    }

    // ==================== JS 桥注入 ====================

    private void injectJsBridge() {
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().addJavascriptInterface(
                    new VideoXJsBridge(), "__videoXBridge");
                Log.i(TAG, "JS 桥注入成功");
            } else {
                Log.w(TAG, "WebView 尚未就绪，延迟注入");
                // 延迟再试
                new Handler(Looper.getMainLooper()).postDelayed(
                    this::injectJsBridge, 300);
            }
        } catch (Exception e) {
            Log.e(TAG, "JS 桥注入失败", e);
        }
    }

    // ==================== 视频准备：快速路径 + 慢速路径 ====================

    private void resolveAndPrepareVideo(Uri uri) {
        // ---- 路径 1：尝试从 content:// URI 解析真实文件路径 ----
        String realPath = resolveRealPath(uri);
        if (realPath != null && new File(realPath).exists()) {
            pendingVideoPath = realPath;
            pendingVideoName = new File(realPath).getName();
            Log.i(TAG, "快速路径 — 真实路径: " + realPath + " (" + pendingVideoName + ")");
            return;
        }

        // ---- 路径 2：复制到缓存目录（慢速，后台线程） ----
        Log.i(TAG, "快速路径未命中，开始复制文件...");
        copyToCacheAsync(uri);
    }

    /**
     * 尝试从 content:// URI 解析出真实文件路径。
     * - Android 10+ (scoped storage): _data 列可能为空，返回 null
     * - 文件管理器 / "用其他应用打开": _data 列通常可用
     */
    private String resolveRealPath(Uri uri) {
        // 已经是 file:// 路径，直接使用
        if ("file".equals(uri.getScheme())) {
            String path = uri.getPath();
            return (path != null) ? path : null;
        }

        // 方法1: 尝试 _data 列
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(
                uri,
                new String[]{MediaStore.Video.Media.DATA},
                null, null, null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(MediaStore.Video.Media.DATA);
                if (idx >= 0) {
                    String path = cursor.getString(idx);
                    if (path != null && !path.isEmpty() && new File(path).exists()) {
                        return path;
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "_data 列解析失败: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }

        // 方法2: 尝试通用 _data 查询（非 MediaStore 内容提供者）
        try {
            cursor = getContentResolver().query(
                uri, new String[]{"_data"}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex("_data");
                if (idx >= 0) {
                    String path = cursor.getString(idx);
                    if (path != null && !path.isEmpty() && new File(path).exists()) {
                        return path;
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "通用 _data 解析失败: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }

        return null;
    }

    // ==================== 慢速路径：文件复制 ====================

    private void copyToCacheAsync(Uri uri) {
        new Thread(() -> {
            ContentResolver cr = getContentResolver();
            String fileName = "video_" + System.currentTimeMillis();
            File destFile = null;

            try {
                // 获取文件名
                Cursor cursor = cr.query(uri, null, null, null, null);
                if (cursor != null) {
                    if (cursor.moveToFirst()) {
                        int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0) {
                            String name = cursor.getString(idx);
                            if (name != null && !name.isEmpty()) {
                                fileName = sanitizeFileName(name);
                            }
                        }
                    }
                    cursor.close();
                }

                // 复制文件
                File cacheDir = getCacheDir();
                destFile = new File(cacheDir, fileName);
                int counter = 1;
                String baseName = fileName;
                String ext = "";
                int dotIdx = baseName.lastIndexOf('.');
                if (dotIdx > 0) {
                    ext = baseName.substring(dotIdx);
                    baseName = baseName.substring(0, dotIdx);
                }
                while (destFile.exists()) {
                    destFile = new File(cacheDir, baseName + "_(" + counter + ")" + ext);
                    counter++;
                }

                InputStream is = cr.openInputStream(uri);
                FileOutputStream os = new FileOutputStream(destFile);
                byte[] buf = new byte[8192];
                int len;
                long totalBytes = 0;
                while ((len = is.read(buf)) > 0) {
                    os.write(buf, 0, len);
                    totalBytes += len;
                }
                is.close();
                os.close();

                pendingVideoPath = destFile.getAbsolutePath();
                pendingVideoName = destFile.getName();
                Log.i(TAG, "慢速路径完成: " + pendingVideoPath + " (" + totalBytes + " bytes)");

            } catch (Exception e) {
                Log.e(TAG, "文件复制失败", e);
                if (destFile != null && destFile.exists()) destFile.delete();
            }
        }).start();
    }

    // ==================== 工具 ====================

    private String sanitizeFileName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
    }
}
