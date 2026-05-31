package com.givemesix.videox.player;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * VideoX 原生播放器插件
 *
 * v2.2: 支持 file:// 路径和 content:// URI 两种输入
 * content:// URI 直传 ExoPlayer，无需文件复制，实现秒开
 */
@CapacitorPlugin(name = "VideoXPlayer")
public class VideoXPlayerPlugin extends Plugin {

    private static final String TAG = "VideoXPlayer";
    private PluginCall pendingCall;

    @PluginMethod
    public void play(PluginCall call) {
        String filePath = call.getString("path");
        String videoUri  = call.getString("uri");   // v2.2: content:// URI
        String fileName  = call.getString("name", "未知视频");

        // --- 输入校验 ---
        if (videoUri != null && !videoUri.isEmpty()) {
            // content:// URI 路径 — 直接传给 ExoPlayer
            Log.d(TAG, "准备播放 (URI): " + fileName + " → " + videoUri);
            launchPlayer(null, videoUri, fileName, call);
            return;
        }

        if (filePath == null || filePath.isEmpty()) {
            call.reject("缺少文件路径参数 (path 或 uri)");
            return;
        }

        // file:// 路径 — 校验文件是否存在
        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("文件不存在: " + filePath);
            return;
        }

        Log.d(TAG, "准备播放 (文件): " + fileName + " (" + filePath + ")");
        launchPlayer(filePath, null, fileName, call);
    }

    private void launchPlayer(String filePath, String videoUri, String fileName, PluginCall call) {
        pendingCall = call;

        Intent intent = new Intent(getActivity(), VideoXPlayerActivity.class);
        if (filePath != null) {
            intent.putExtra("video_path", filePath);
        }
        if (videoUri != null) {
            intent.putExtra("video_uri", videoUri);
        }
        intent.putExtra("video_name", fileName);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            startActivityForResult(call, intent, "playVideoResult");
        } else {
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("completed", true);
            call.resolve(ret);
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (pendingCall != null) {
            JSObject ret = new JSObject();
            ret.put("completed", true);
            ret.put("resultCode", resultCode);
            pendingCall.resolve(ret);
            pendingCall = null;
        }
    }

    @PluginMethod
    public void getSupportedFormats(PluginCall call) {
        JSObject ret = new JSObject();
        String[] formats = {
            "rmvb", "rm", "wmv", "asf", "flv", "f4v",
            "mpg", "mpeg", "vob", "evo", "m2ts", "mts",
            "divx", "xvid", "ogv", "ogm", "3gp", "3g2",
            "mp4", "mkv", "avi", "mov", "webm", "ts", "m4v"
        };
        JSObject formatsArray = new JSObject();
        try {
            for (int i = 0; i < formats.length; i++) {
                formatsArray.put(String.valueOf(i), formats[i]);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error building formats", e);
        }
        ret.put("formats", formatsArray);
        call.resolve(ret);
    }
}
