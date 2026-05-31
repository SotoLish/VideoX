package com.givemesix.videox.player;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import com.givemesix.videox.R;
import java.io.File;

/**
 * 原生视频播放 Activity
 * 使用 ExoPlayer + Jellyfin FFmpeg 解码器，支持 RMVB 等所有常见格式
 *
 * v2.2: 支持 video_uri (content:// URI 直传) 和 video_path (file:// 路径) 两种方式
 */
public class VideoXPlayerActivity extends AppCompatActivity {

    private ExoPlayer player;
    private PlayerView playerView;
    private ImageButton btnBack;
    private TextView tvTitle;
    private String videoPath;
    private String videoUri;
    private String videoName;
    private boolean playWhenReady = true;
    private long playbackPosition = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏沉浸
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );

        setContentView(R.layout.activity_videox_player);

        videoPath = getIntent().getStringExtra("video_path");
        videoUri  = getIntent().getStringExtra("video_uri");
        videoName = getIntent().getStringExtra("video_name");

        if (videoPath == null && videoUri == null) {
            Toast.makeText(this, "视频来源为空", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        initViews();
        initPlayer();
    }

    private void initViews() {
        playerView = findViewById(R.id.exo_player_view);
        btnBack = findViewById(R.id.btn_back);
        tvTitle = findViewById(R.id.tv_video_title);

        if (tvTitle != null) {
            tvTitle.setText(videoName != null ? videoName : "VideoX Player");
        }

        if (btnBack != null) {
            btnBack.setOnClickListener(v -> finish());
        }
    }

    private void initPlayer() {
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        playerView.setUseController(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);

        MediaItem mediaItem;

        // --- 路径 1: content:// URI 直接使用（ExoPlayer 原生支持）---
        if (videoUri != null && !videoUri.isEmpty()) {
            Uri parsedUri = Uri.parse(videoUri);
            mediaItem = MediaItem.fromUri(parsedUri);
        }
        // --- 路径 2: file:// 路径 ---
        else {
            File videoFile = new File(videoPath);
            if (!videoFile.exists()) {
                Toast.makeText(this, "文件不存在: " + videoPath, Toast.LENGTH_LONG).show();
                finish();
                return;
            }
            Uri fileUri = Uri.fromFile(videoFile);
            mediaItem = MediaItem.fromUri(fileUri);
        }

        player.setMediaItem(mediaItem);

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    finish();
                }
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                Toast.makeText(VideoXPlayerActivity.this,
                    "播放失败: " + error.getLocalizedMessage(),
                    Toast.LENGTH_LONG).show();
                finish();
            }
        });

        player.prepare();
        player.setPlayWhenReady(playWhenReady);

        if (playbackPosition > 0) {
            player.seekTo(playbackPosition);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (player != null) player.setPlayWhenReady(playWhenReady);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null) player.setPlayWhenReady(playWhenReady);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            playWhenReady = player.getPlayWhenReady();
            playbackPosition = player.getCurrentPosition();
            player.setPlayWhenReady(false);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) player.setPlayWhenReady(false);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
    }
}
