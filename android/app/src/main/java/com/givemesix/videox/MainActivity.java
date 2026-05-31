package com.givemesix.videox;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.givemesix.videox.player.VideoXPlayerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 注册自定义插件
        registerPlugin(VideoXPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
