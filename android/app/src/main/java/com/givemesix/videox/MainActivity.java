package com.givemesix.videox;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.JavascriptInterface;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.BridgeActivity;
import com.givemesix.videox.player.VideoXPlayerPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * VideoX 主 Activity — Capacitor Bridge + 外部视频 Intent 处理
 *
 * v2.2 核心改进：
 * - 外部 content:// URI 直接传给原生 ExoPlayer（不复制文件，秒开）
 * - 运行时申请存储权限（首次启动弹窗）
 * - JS 桥增加 getPendingVideoUri() 方法
 * - SAF ACTION_OPEN_DOCUMENT_TREE 文件夹浏览
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "VideoX";

    // --- 外部视频待处理数据（由 JS 端轮询读取）---
    private volatile String pendingVideoPath = null;
    private volatile String pendingVideoName = null;
    private volatile String pendingVideoUri  = null; // content:// URI，给原生 ExoPlayer 直播
    private volatile String folderTreeUri    = null; // SAF 文件夹浏览 URI

    // --- 权限请求 ---
    private ActivityResultLauncher<String[]> permissionLauncher;
    private Uri pendingPermissionUri = null; // 等权限授予后再处理的 URI

    // --- SAF 文件夹选择 ---
    private ActivityResultLauncher<Intent> folderPickerLauncher;

    // ==================== Android ↔ JS 桥接 ====================

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
        @JavascriptInterface
        public String getPendingVideoUri() {
            String u = pendingVideoUri;
            return (u != null) ? u : "";
        }
        @JavascriptInterface
        public String getFolderTreeUri() {
            String u = folderTreeUri;
            return (u != null) ? u : "";
        }
        /** 由 JS 调用，让 Android 发起 SAF 文件夹选择器 */
        @JavascriptInterface
        public void pickFolder() {
            new Handler(Looper.getMainLooper()).post(() -> launchFolderPicker());
        }
        /** 由 JS 调用，让 Android 在 SAF tree URI 中扫描视频文件 */
        @JavascriptInterface
        public String scanFolderVideos(String treeUriStr) {
            return scanTreeForVideos(treeUriStr);
        }
    }

    // ==================== 生命周期 ====================

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VideoXPlayerPlugin.class);

        final Uri videoUri = extractVideoUri(getIntent());
        super.onCreate(savedInstanceState);

        // --- 权限请求注册 ---
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                boolean allGranted = true;
                for (Boolean granted : result.values()) {
                    if (!granted) { allGranted = false; break; }
                }
                Log.i(TAG, "权限结果: " + (allGranted ? "全部授予" : "部分拒绝"));
                // 权限回调后，接着处理之前挂起的 URI
                if (pendingPermissionUri != null) {
                    resolveAndPrepareVideo(pendingPermissionUri);
                    pendingPermissionUri = null;
                }
            }
        );

        // --- SAF 文件夹选择器注册 ---
        folderPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Uri treeUri = result.getData().getData();
                    if (treeUri != null) {
                        // 持久化权限
                        final int takeFlags = result.getData().getFlags()
                            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        try {
                            getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                        } catch (Exception e) {
                            Log.w(TAG, "takePersistableUriPermission 失败: " + e.getMessage());
                        }
                        folderTreeUri = treeUri.toString();
                        Log.i(TAG, "SAF 文件夹已选择: " + folderTreeUri);
                    }
                }
            }
        );

        injectJsBridge();

        // 在首次启动时请求权限
        if (videoUri != null) {
            Log.i(TAG, "检测到外部视频 URI: " + videoUri);
            requestPermissionsThenHandle(videoUri);
        } else {
            // 即使没有外部视频，也检查权限（首次启动弹窗）
            ensurePermissions();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri videoUri = extractVideoUri(intent);
        if (videoUri == null) return;
        Log.i(TAG, "热启动外部视频 URI: " + videoUri);
        requestPermissionsThenHandle(videoUri);
    }

    // ==================== 工具：提取视频 URI ====================

    private Uri extractVideoUri(Intent intent) {
        if (intent == null) return null;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        return intent.getData();
    }

    // ==================== 权限 ====================

    private void requestPermissionsThenHandle(Uri videoUri) {
        if (hasStoragePermission()) {
            resolveAndPrepareVideo(videoUri);
        } else {
            pendingPermissionUri = videoUri;
            requestStoragePermission();
        }
    }

    private void ensurePermissions() {
        if (!hasStoragePermission()) {
            requestStoragePermission();
        }
    }

    private boolean hasStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+
            return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO)
                   == PackageManager.PERMISSION_GRANTED;
        } else {
            // Android 12 及以下
            return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                   == PackageManager.PERMISSION_GRANTED;
        }
    }

    private void requestStoragePermission() {
        String[] perms;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms = new String[]{ Manifest.permission.READ_MEDIA_VIDEO };
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            perms = new String[]{ Manifest.permission.READ_EXTERNAL_STORAGE };
        } else {
            perms = new String[]{
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            };
        }
        Log.i(TAG, "请求权限: " + java.util.Arrays.toString(perms));
        permissionLauncher.launch(perms);
    }

    // ==================== JS 桥注入 ====================

    private void injectJsBridge() {
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().addJavascriptInterface(
                    new VideoXJsBridge(), "__videoXBridge");
                Log.i(TAG, "JS 桥注入成功");
            } else {
                Log.w(TAG, "WebView 尚未就绪，300ms 后重试");
                new Handler(Looper.getMainLooper()).postDelayed(
                    this::injectJsBridge, 300);
            }
        } catch (Exception e) {
            Log.e(TAG, "JS 桥注入失败", e);
        }
    }

    // ==================== SAF 文件夹选择 ====================

    private void launchFolderPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            folderPickerLauncher.launch(intent);
        } catch (Exception e) {
            Log.e(TAG, "启动文件夹选择器失败", e);
        }
    }

    /**
     * 扫描 SAF tree URI 中的视频文件，返回 JSON 格式文件列表。
     * 递归遍历所有文件夹，收集视频文件。
     */
    private String scanTreeForVideos(String treeUriStr) {
        StringBuilder json = new StringBuilder("[");
        try {
            Uri treeUri = Uri.parse(treeUriStr);
            DocumentFile rootDoc = DocumentFile.fromTreeUri(this, treeUri);
            if (rootDoc != null) {
                scanDocumentTree(rootDoc, "", json);
            }
        } catch (Exception e) {
            Log.e(TAG, "扫描文件夹失败", e);
        }
        // 去除末尾逗号
        if (json.length() > 1 && json.charAt(json.length() - 1) == ',') {
            json.setLength(json.length() - 1);
        }
        json.append("]");
        Log.i(TAG, "扫描完成，找到视频: " + json.toString());
        return json.toString();
    }

    private void scanDocumentTree(DocumentFile dir, String prefix, StringBuilder json) {
        for (DocumentFile doc : dir.listFiles()) {
            String name = doc.getName();
            if (name == null) continue;
            if (doc.isDirectory()) {
                scanDocumentTree(doc, prefix + name + "/", json);
            } else if (isVideoFile(name)) {
                String uri = doc.getUri().toString();
                long size = doc.length();
                // JSON 格式：{name, uri, size, dir}
                json.append("{\"name\":\"")
                    .append(escapeJson(name)).append("\",")
                    .append("\"uri\":\"")
                    .append(escapeJson(uri)).append("\",")
                    .append("\"size\":").append(size).append(",")
                    .append("\"dir\":\"")
                    .append(escapeJson(prefix.replaceAll("/$", ""))).append("\"")
                    .append("},");
            }
        }
    }

    private boolean isVideoFile(String name) {
        String lower = name.toLowerCase();
        return lower.matches(".*\\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|3gp|rmvb|rm|hevc|h265|mpg|mpeg|ogv|vob|divx|xvid|asf|evo|ogm)$");
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    // ==================== 视频准备：快速路径 + URI 直传路径 ====================

    private void resolveAndPrepareVideo(Uri uri) {
        String scheme = uri.getScheme();
        Log.i(TAG, "处理 URI: scheme=" + scheme + " uri=" + uri);

        // --- 获取显示名称 ---
        String fileName = extractFileName(uri);

        // --- 路径 1: file:// 直接使用 ---
        if ("file".equals(scheme)) {
            String filePath = uri.getPath();
            if (filePath != null) {
                File f = new File(filePath);
                if (f.exists() && f.canRead()) {
                    pendingVideoPath = filePath;
                    pendingVideoName = f.getName();
                    pendingVideoUri = null;
                    Log.i(TAG, "file:// 路径可用: " + filePath);
                    return;
                }
                // 文件存在但不可读（权限问题）→ 开权限后重试
                Log.w(TAG, "file:// 路径不可读: " + filePath + "，需要权限");
                pendingVideoPath = filePath;
                pendingVideoName = fileName;
                pendingVideoUri = null;
                return;
            }
        }

        // --- 路径 2: content:// 尝试解析真实路径（有存储权限时可用）---
        if (hasStoragePermission()) {
            String realPath = resolveRealPath(uri);
            if (realPath != null && new File(realPath).exists() && new File(realPath).canRead()) {
                pendingVideoPath = realPath;
                pendingVideoName = new File(realPath).getName();
                pendingVideoUri = null;
                Log.i(TAG, "content:// 解析到真实路径: " + realPath);
                return;
            }
        }

        // --- 路径 3: content:// URI 直传给原生 ExoPlayer（最佳路径）---
        // ExoPlayer 原生支持 content:// URI 播放，无需复制文件，秒开
        pendingVideoUri = uri.toString();
        pendingVideoName = fileName;
        pendingVideoPath = null;
        Log.i(TAG, "content:// URI 直传 ExoPlayer: " + pendingVideoUri + " (" + fileName + ")");
    }

    /**
     * 从 content:// URI 提取文件名。
     */
    private String extractFileName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                // 尝试 DISPLAY_NAME
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) {
                        return sanitizeFileName(name);
                    }
                }
                // 备选：_display_name
                idx = cursor.getColumnIndex("_display_name");
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) {
                        return sanitizeFileName(name);
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "extractFileName 失败: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
        // 兜底：从 URI 路径提取
        String lastSegment = uri.getLastPathSegment();
        return (lastSegment != null) ? sanitizeFileName(lastSegment) : "video_" + System.currentTimeMillis();
    }

    /**
     * 尝试从 content:// URI 解析出真实文件路径。
     * Android 10+ scoped storage 下 _data 列通常为 NULL。
     */
    private String resolveRealPath(Uri uri) {
        // 方法1: MediaStore _data 列
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
            Log.d(TAG, "MediaStore _data 列查询失败: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }

        // 方法2: 通用 _data 查询
        try {
            cursor = getContentResolver().query(uri, new String[]{"_data"}, null, null, null);
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
            Log.d(TAG, "通用 _data 查询失败: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }

        return null;
    }

    // ==================== 工具 ====================

    private String sanitizeFileName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
    }
}
