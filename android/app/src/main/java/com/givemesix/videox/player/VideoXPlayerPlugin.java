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
 * 用于播放 WebView 不支持的视频格式（如 RMVB、RM 等）
 * 通过 ExoPlayer Activity 实现原生解码播放
 */
@CapacitorPlugin(name = "VideoXPlayer")
public class VideoXPlayerPlugin extends Plugin {

    private static final String TAG = "VideoXPlayer";
    private PluginCall pendingCall;

    @PluginMethod
    public void play(PluginCall call) {
        String filePath = call.getString("path");
        String fileName = call.getString("name", "未知视频");

        if (filePath == null || filePath.isEmpty()) {
            call.reject("缺少文件路径参数");
            return;
        }

        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("文件不存在: " + filePath);
            return;
        }

        Log.d(TAG, "准备播放: " + fileName + " (" + filePath + ")");

        pendingCall = call;

        Intent intent = new Intent(getActivity(), VideoXPlayerActivity.class);
        intent.putExtra("video_path", filePath);
        intent.putExtra("video_name", fileName);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        // 用 startActivityForResult 替代已弃用的 saveCall
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            startActivityForResult(call, intent, "playVideoResult");
        } else {
            getActivity().startActivity(intent);
            // 旧版 Android 直接返回成功
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
        // ExoPlayer + FFmpeg 扩展支持几乎所有格式
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
