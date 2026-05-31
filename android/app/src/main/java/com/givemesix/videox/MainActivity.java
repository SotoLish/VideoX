package com.givemesix.videox;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.givemesix.videox.player.VideoXPlayerPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "VideoX";
    private static final int MAX_POLL_ATTEMPTS = 40;  // 20 秒最大等待
    private static final int MAX_INJECT_ATTEMPTS = 30; // 15 秒最大等待
    private static final int POLL_INTERVAL_MS = 500;
    private static final int INJECT_INTERVAL_MS = 500;

    private Uri pendingVideoUri = null;
    private String pendingVideoPath = null;
    private String pendingVideoName = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VideoXPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            pendingVideoUri = intent.getData();
            Log.i(TAG, "Cold start with external video: " + pendingVideoUri);
            startPollingWebView();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        pendingVideoUri = uri;
        Log.i(TAG, "Warm start with external video: " + pendingVideoUri);
        startPollingWebView();
    }

    // ==================== 轮询等待 WebView 就绪 ====================

    private void startPollingWebView() {
        pollWebView(0);
    }

    private void pollWebView(int attempt) {
        if (attempt >= MAX_POLL_ATTEMPTS) {
            Log.e(TAG, "WebView 超时未就绪，放弃处理外部视频");
            return;
        }

        if (bridge != null && bridge.getWebView() != null) {
            Log.i(TAG, "WebView 就绪 (attempt " + attempt + ")，开始处理外部视频");
            processPendingVideo();
        } else {
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> pollWebView(attempt + 1), POLL_INTERVAL_MS);
        }
    }

    // ==================== 处理外部视频 ====================

    private void processPendingVideo() {
        if (pendingVideoUri == null) return;
        final Uri uri = pendingVideoUri;
        pendingVideoUri = null;

        new Thread(() -> {
            try {
                ContentResolver cr = getContentResolver();

                // 获取文件名
                String fileName = "video_" + System.currentTimeMillis();
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

                // 复制到缓存目录
                File cacheDir = getCacheDir();
                File destFile = new File(cacheDir, fileName);

                // 避免重名覆盖
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

                // 复制文件
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

                Log.i(TAG, "外部视频已复制: " + destFile.getAbsolutePath()
                    + " (" + totalBytes + " bytes)");

                pendingVideoPath = destFile.getAbsolutePath();
                pendingVideoName = destFile.getName();

                // 开始注入 JS
                runOnUiThread(() -> injectVideoJs(0));

            } catch (Exception e) {
                Log.e(TAG, "处理外部视频失败", e);
                pendingVideoPath = null;
                pendingVideoName = null;
            }
        }).start();
    }

    // ==================== JS 注入（含重试） ====================

    private void injectVideoJs(int attempt) {
        if (attempt >= MAX_INJECT_ATTEMPTS) {
            Log.e(TAG, "JS 注入超时，外部视频可能无法自动播放");
            return;
        }

        if (bridge == null || bridge.getWebView() == null) {
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> injectVideoJs(attempt + 1), INJECT_INTERVAL_MS);
            return;
        }

        if (pendingVideoPath == null || pendingVideoName == null) {
            Log.w(TAG, "没有待注入的视频信息");
            return;
        }

        final String escapedPath = pendingVideoPath
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "");
        final String escapedName = pendingVideoName
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "");

        String js = "try{" +
            "if(typeof window.handleExternalVideo==='function'){" +
            "window.handleExternalVideo('" + escapedPath + "','" + escapedName + "');" +
            "JSON.stringify({result:'ok'})" +
            "}else{" +
            "JSON.stringify({result:'retry',reason:'fn_undefined'})" +
            "}" +
            "}catch(e){" +
            "JSON.stringify({result:'retry',reason:e.message})" +
            "}";

        bridge.getWebView().evaluateJavascript(js, value -> {
            Log.d(TAG, "Inject attempt " + attempt + " result: " + value);
            if (value == null || !value.contains("\"result\":\"ok\"")) {
                new Handler(Looper.getMainLooper()).postDelayed(
                    () -> injectVideoJs(attempt + 1), INJECT_INTERVAL_MS);
            } else {
                Log.i(TAG, "JS 注入成功 (attempt " + attempt + ")");
                pendingVideoPath = null;
                pendingVideoName = null;
            }
        });
    }

    // ==================== 工具方法 ====================

    private String sanitizeFileName(String name) {
        // 移除可能导致问题的字符
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
    }
}
