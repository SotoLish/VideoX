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
    private Uri pendingVideoUri = null;
    private boolean webViewReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VideoXPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // 延迟标记 WebView 就绪
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            webViewReady = true;
            processPendingVideo();
        }, 800);

        // 检查是否从外部应用打开
        Intent intent = getIntent();
        handleIntent(intent);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        pendingVideoUri = uri;
        if (webViewReady) {
            processPendingVideo();
        }
    }

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
                                fileName = name;
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
                    destFile = new File(cacheDir, baseName + "_" + counter + ext);
                    counter++;
                }

                InputStream is = cr.openInputStream(uri);
                FileOutputStream os = new FileOutputStream(destFile);
                byte[] buf = new byte[8192];
                int len;
                while ((len = is.read(buf)) > 0) {
                    os.write(buf, 0, len);
                }
                is.close();
                os.close();

                final String finalPath = destFile.getAbsolutePath().replace("\\", "\\\\").replace("'", "\\'");
                final String finalName = destFile.getName().replace("\\", "\\\\").replace("'", "\\'");

                Log.i(TAG, "External video copied to: " + finalPath);

                runOnUiThread(() -> {
                    if (bridge != null && bridge.getWebView() != null) {
                        bridge.getWebView().evaluateJavascript(
                            "(function(){if(window.handleExternalVideo)window.handleExternalVideo('"
                            + finalPath + "','" + finalName + "')})()",
                            null
                        );
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "Failed to process external video", e);
                runOnUiThread(() -> {
                    if (bridge != null && bridge.getWebView() != null) {
                        bridge.getWebView().evaluateJavascript(
                            "(function(){if(window.handleExternalVideoError)window.handleExternalVideoError('"
                            + e.getMessage().replace("'", "\\'") + "')})()",
                            null
                        );
                    }
                });
            }
        }).start();
    }
}
