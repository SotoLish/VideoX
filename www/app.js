/* ===== app.js — VideoX 移动端视频播放器 ===== */
'use strict';

// ==================== 状态管理 ====================
const state = {
  files: [],           // 所有视频文件（File 对象）
  folderStructure: {}, // 文件夹结构
  currentIndex: -1,    // 当前播放索引
  showHidden: true,    // 是否显示隐藏文件夹
  speed: 1,            // 当前倍速
  duration: 0,         // 视频时长
  isSeeking: false,     // 是否正在拖动进度条
  controlsVisible: true,
  controlsTimer: null,
  orientBarTimer: null, // 适应模式提示条定时器
  isCasting: false,
  castDevice: null,
  currentFolder: 'root',
  folderStack: [],
  uiHideDelay: 3500,
  // 视频方向
  videoIsPortrait: false,
  videoWidth: 0,
  videoHeight: 0,
  // 适应模式：'contain' | 'cover' | 'rotate'
  fitMode: 'contain',
  // NAS 文件列表
  nasFiles: null,      // NAS 文件数组 [{name,size,path}]
  nasBaseUrl: '',      // NAS 基础 URL
  nasIndex: -1,        // NAS 当前播放索引
};

// ==================== DOM 获取 ====================
const $ = id => document.getElementById(id);

const pageBrowser    = $('page-browser');
const pagePlayer     = $('page-player');
const folderInput    = $('folder-input');
const fileList       = $('file-list');
const breadcrumb     = $('breadcrumb');
const scanBanner     = $('scan-banner');
const btnOpenFolder  = $('btn-open-folder');
const btnScan        = $('btn-scan');
const btnToggleHidden = $('btn-toggle-hidden');
const hiddenLabel    = $('hidden-label');

const video          = $('main-video');
const videoTitle     = $('video-title');
const playerTopbar   = $('player-topbar');
const playerControls = $('player-controls');
const centerTap      = $('center-tap');
const gestureLeft    = $('gesture-left');
const gestureRight   = $('gesture-right');
const hintLeft       = $('hint-left');
const hintRight      = $('hint-right');
const playAnim       = $('play-anim');
const videoWrap      = $('video-wrap');

const btnBack        = $('btn-back');
const btnCast        = $('btn-cast');
const castLabel      = $('cast-label');
const btnPlayPause   = $('btn-play-pause');
const iconPlay       = $('icon-play');
const iconPause      = $('icon-pause');
const btnSkipBack    = $('btn-skip-back');
const btnSkipFwd     = $('btn-skip-fwd');
const btnSpeed       = $('btn-speed');
const speedLabel     = $('speed-label');
const btnFullscreen  = $('btn-fullscreen');
const btnFit         = $('btn-fit');
const fitLabel       = $('fit-label');
const fitIconContain = $('fit-icon-contain');
const fitIconCover   = $('fit-icon-cover');
const fitIconRotate  = $('fit-icon-rotate');
const orientBadge    = $('orient-badge');
const orientBar      = $('orientation-bar');
const orientBarText  = $('orientation-bar-text');

const timeCur        = $('time-cur');
const timeTotal      = $('time-total');
const progressBg     = $('progress-bg');
const progressFill   = $('progress-fill');
const progressBuf    = $('progress-buf');
const progressThumb  = $('progress-thumb');

const speedPanel     = $('speed-panel');
const speedOptions   = $('speed-options');
const castPanel      = $('cast-panel');
const castDevices    = $('cast-devices');
const btnCloseCast   = $('btn-close-cast');
const castScanning   = $('cast-scanning');
const playlistSidebar = $('playlist-sidebar');
const playlistItems  = $('playlist-items');
const btnClosePlaylist = $('btn-close-playlist');
const overlay        = $('overlay');

// ==================== 工具函数 ====================
function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function isVideoFile(name) {
  return /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|3gp|rmvb|rm|hevc|h265|mpg|mpeg|ogv|vob|divx|xvid)$/i.test(name);
}

// RMVB/RM 格式需要原生播放器，浏览器不支持
function isRmvbFile(name) {
  return /\.(rmvb|rm)$/i.test(name);
}

// 需要原生播放器的格式（WebView 不支持）
function needsNativePlayer(name) {
  return /\.(rmvb|rm|wmv|asf|vob|evo|divx|xvid|ogv|ogm)$/i.test(name);
}

function isHidden(name) {
  return name.startsWith('.');
}

function showBurst(icon) {
  playAnim.textContent = icon;
  playAnim.classList.remove('burst');
  void playAnim.offsetWidth; // 强制重绘触发动画
  playAnim.classList.add('burst');
}

// ==================== 文件夹扫描 ====================
function processFileList(fileArray) {
  const structure = {};
  const allVideos = [];
  const rmvbFiles = [];

  fileArray.forEach(file => {
    const parts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const dirPath = dirParts.length > 0 ? dirParts.join('/') : 'root';

    // 注册所有中间目录
    for (let i = 0; i <= dirParts.length; i++) {
      const parentPath = i === 0 ? 'root' : dirParts.slice(0, i).join('/');
      const childName = dirParts[i];
      if (!structure[parentPath]) structure[parentPath] = { folders: new Set(), files: [] };
      if (childName) structure[parentPath].folders.add(childName);
    }

    if (!structure[dirPath]) structure[dirPath] = { folders: new Set(), files: [] };

    if (isVideoFile(fileName)) {
      file._dir = dirPath;
      if (isRmvbFile(fileName)) {
        rmvbFiles.push(fileName);
      }
      structure[dirPath].files.push(file);
      allVideos.push(file);
    }
  });

  state.files = allVideos;
  state.folderStructure = structure;
  state.folderStack = [];
  renderBreadcrumb();
  renderFolder('root');

  // RMVB 格式提示
  if (rmvbFiles.length > 0) {
    showRmvbWarning(rmvbFiles.length);
  }

  if (allVideos.length === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <p>未找到视频文件</p>
        <small>支持 MP4、MKV、AVI、MOV、WebM 等格式</small>
      </div>`;
  }
}

// ==================== 文件夹渲染 ====================
function renderFolder(path) {
  state.currentFolder = path;
  const structure = state.folderStructure;
  const entry = structure[path] || { folders: new Set(), files: [] };

  fileList.innerHTML = '';

  const allFolders = [...entry.folders];
  const visibleFolders = state.showHidden ? allFolders : allFolders.filter(f => !isHidden(f));
  const hiddenFolders = allFolders.filter(f => isHidden(f));

  if (visibleFolders.length === 0 && entry.files.length === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <p>此文件夹中没有视频文件</p>
        <small>支持 MP4、MKV、AVI、MOV 等格式</small>
      </div>`;
    return;
  }

  // 渲染子文件夹
  if (visibleFolders.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '文件夹';
    fileList.appendChild(label);

    visibleFolders.sort().forEach(folderName => {
      const folderPath = path === 'root' ? folderName : `${path}/${folderName}`;
      const subEntry = structure[folderPath] || { folders: new Set(), files: [] };
      const subVideoCount = countVideos(folderPath);
      const hidden = isHidden(folderName);

      const item = document.createElement('div');
      item.className = 'file-item folder-item';
      item.innerHTML = `
        <div class="file-icon">${hidden ? '🔒' : '📁'}</div>
        <div class="file-info">
          <div class="file-name">${folderName}</div>
          <div class="file-meta">${subVideoCount} 个视频${subEntry.folders.size > 0 ? ` · ${subEntry.folders.size} 个子文件夹` : ''}</div>
        </div>
        ${hidden ? '<span class="file-badge hidden-badge">隐藏</span>' : ''}
        <span class="file-arrow">›</span>
      `;
      item.addEventListener('click', () => {
        state.folderStack.push(path);
        renderBreadcrumb(folderPath);
        renderFolder(folderPath);
      });
      fileList.appendChild(item);
    });
  }

  // 渲染视频文件
  const videos = entry.files;
  if (videos.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `视频文件（${videos.length}）`;
    fileList.appendChild(label);

    videos.forEach(file => {
      const globalIdx = state.files.indexOf(file);
      const item = document.createElement('div');
      item.className = 'file-item video-item';
      item.innerHTML = `
        <div class="file-icon">🎬</div>
        <div class="file-info">
          <div class="file-name">${file.name}</div>
          <div class="file-meta">${formatSize(file.size)}</div>
        </div>
        <span class="file-arrow">▶</span>
      `;
      item.addEventListener('click', () => playVideo(globalIdx));
      fileList.appendChild(item);
    });
  }

  // 隐藏文件夹提示
  if (!state.showHidden && hiddenFolders.length > 0) {
    const tip = document.createElement('div');
    tip.className = 'hidden-folder-tip';
    tip.textContent = `🔒 还有 ${hiddenFolders.length} 个隐藏文件夹，点击右上角眼睛图标显示`;
    fileList.appendChild(tip);
  }
}

function countVideos(path) {
  const structure = state.folderStructure;
  const entry = structure[path];
  if (!entry) return 0;
  let count = entry.files.length;
  entry.folders.forEach(f => {
    const subPath = path === 'root' ? f : `${path}/${f}`;
    count += countVideos(subPath);
  });
  return count;
}

// ==================== 面包屑 ====================
function renderBreadcrumb(currentPath) {
  breadcrumb.innerHTML = '';

  const rootItem = document.createElement('span');
  rootItem.className = 'bc-item';
  rootItem.textContent = '📁 存储';
  rootItem.addEventListener('click', () => {
    state.folderStack = [];
    renderBreadcrumb();
    renderFolder('root');
  });
  breadcrumb.appendChild(rootItem);

  if (!currentPath || currentPath === 'root') {
    rootItem.classList.add('active');
    return;
  }

  const parts = currentPath.split('/');
  parts.forEach((part, i) => {
    const sep = document.createElement('span');
    sep.className = 'bc-sep';
    sep.textContent = ' › ';
    breadcrumb.appendChild(sep);

    const item = document.createElement('span');
    item.className = 'bc-item';
    item.textContent = part;
    const pathSoFar = parts.slice(0, i + 1).join('/');
    if (i === parts.length - 1) {
      item.classList.add('active');
    } else {
      item.addEventListener('click', () => {
        state.folderStack = state.folderStack.slice(0, i + 1);
        renderBreadcrumb(pathSoFar);
        renderFolder(pathSoFar);
      });
    }
    breadcrumb.appendChild(item);
  });
}

// ==================== 显示/隐藏文件夹切换 ====================
btnToggleHidden.addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  hiddenLabel.textContent = state.showHidden ? '隐藏中' : '隐藏';
  btnToggleHidden.classList.toggle('active', state.showHidden);
  renderFolder(state.currentFolder);
});

// ==================== 打开文件夹 ====================
btnOpenFolder.addEventListener('click', () => folderInput.click());
btnScan.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  scanBanner.classList.add('hidden');
  processFileList(files);
  folderInput.value = ''; // 重置，允许重复选同一文件夹
});

// ==================== 播放视频 ====================
function playVideo(index) {
  if (index < 0 || index >= state.files.length) return;
  state.currentIndex = index;
  const file = state.files[index];

  // 检测是否需要原生播放器
  if (needsNativePlayer(file.name)) {
    playNative(file);
    return;
  }

  // 释放上一个 blob URL
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }

  const url = URL.createObjectURL(file);
  video.src = url;
  video.playbackRate = state.speed;
  videoTitle.textContent = file.name;
  document.title = file.name + ' — VideoX';

  showPage('player');
  video.load(); // 确保新视频加载
  video.play().catch(() => {}); // 某些浏览器自动播放需要用户手势

  renderPlaylist();
  highlightPlaylistItem();
  scheduleHideControls();
}

// ==================== 原生播放器（Capacitor 插件）====================
async function playNative(file) {
  try {
    // 尝试通过 Capacitor 插件播放
    const { VideoXPlayer } = window.Capacitor?.Plugins || {};
    if (VideoXPlayer) {
      // 获取文件的真实路径（需要 File 对象的本地路径）
      const filePath = file.path || file.webkitRelativePath || '';
      await VideoXPlayer.play({ path: filePath, name: file.name });
    } else {
      // 降级：显示提示
      alert('⚠️ ' + file.name + '\n\n此格式（' + file.name.split('.').pop().toUpperCase() + '）需要原生播放器支持\n请在 APK 中运行此功能');
    }
  } catch (e) {
    // 插件不可用时降级
    console.warn('[VideoX] 原生播放器不可用:', e.message);
    alert('⚠️ ' + file.name + '\n\n需要原生播放器（仅 APK 版本支持）\n建议转码为 MP4 后在浏览器中播放');
  }
}

// ==================== 视频方向检测 ====================
// 用 loadeddata 代替 loadedmetadata，确保宽高已准备好
video.addEventListener('loadeddata', () => {
  detectVideoOrientation();
});
// 也监听 loadedmetadata 作为兜底
video.addEventListener('loadedmetadata', () => {
  detectVideoOrientation();
  state.duration = video.duration;
  timeTotal.textContent = formatTime(state.duration);
});

function detectVideoOrientation() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return; // 宽高未准备好时跳过

  state.videoWidth = w;
  state.videoHeight = h;
  state.videoIsPortrait = h > w;

  const label = state.videoIsPortrait ? `竖屏 ${w}×${h}` : `横屏 ${w}×${h}`;
  orientBadge.textContent = label;

  // 每次新视频都重置适应模式
  state.fitMode = 'contain';
  applyFitMode();
}

// ==================== 适应模式 ====================
const FIT_MODES_ALL      = ['contain', 'cover', 'rotate'];
const FIT_MODES_LANDSCAPE = ['contain', 'cover']; // 横屏视频不需要旋转
const FIT_LABELS = { contain: '适应', cover: '填充', rotate: '旋转' };
const FIT_TIPS   = {
  contain: '适应模式：保留黑边，完整显示',
  cover:   '填充模式：裁切边缘，铺满屏幕',
  rotate:  '旋转模式：竖屏视频旋转为横屏',
};

function applyFitMode() {
  const mode = state.fitMode;
  const wrap = videoWrap;

  wrap.classList.remove('fit-cover', 'rotated', 'portrait-video', 'landscape-video');

  if (state.videoIsPortrait) {
    wrap.classList.add('portrait-video');
  } else {
    wrap.classList.add('landscape-video');
  }

  if (mode === 'cover') {
    wrap.classList.add('fit-cover');
  } else if (mode === 'rotate' && state.videoIsPortrait) {
    wrap.classList.add('rotated');
  }

  // 更新按钮图标
  fitIconContain.style.display = mode === 'contain' ? '' : 'none';
  fitIconCover.style.display   = mode === 'cover'   ? '' : 'none';
  fitIconRotate.style.display  = mode === 'rotate'  ? '' : 'none';
  fitLabel.textContent = FIT_LABELS[mode];

  // 显示提示条
  orientBarText.textContent = FIT_TIPS[mode];
  orientBar.classList.add('show');
  clearTimeout(state.orientBarTimer);
  state.orientBarTimer = setTimeout(() => orientBar.classList.remove('show'), 2000);
}

btnFit.addEventListener('click', () => {
  const modes = state.videoIsPortrait ? FIT_MODES_ALL : FIT_MODES_LANDSCAPE;
  const curIdx = modes.indexOf(state.fitMode);
  const nextIdx = (curIdx + 1) % modes.length;
  state.fitMode = modes[nextIdx];
  applyFitMode();
  scheduleHideControls();
});

// ==================== 屏幕方向变化 ====================
function onOrientationChange() {
  setTimeout(() => applyFitMode(), 150);
}
window.addEventListener('orientationchange', onOrientationChange);
window.addEventListener('resize', onOrientationChange);

// ==================== 页面切换 ====================
function showPage(name) {
  pageBrowser.classList.toggle('active', name === 'browser');
  pagePlayer.classList.toggle('active', name === 'player');
  if (name === 'browser') {
    document.title = 'VideoX — 极速播放器';
  }
}

// ==================== 播放/暂停 ====================
function togglePlay() {
  if (video.paused) {
    video.play().catch(() => {});
    showBurst('▶');
  } else {
    video.pause();
    showBurst('⏸');
  }
}

btnPlayPause.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

// center-tap 单独处理，避免与 video-wrap 的 click 冲突
centerTap.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

video.addEventListener('play', () => {
  iconPlay.style.display = 'none';
  iconPause.style.display = '';
  scheduleHideControls();
});
video.addEventListener('pause', () => {
  iconPlay.style.display = '';
  iconPause.style.display = 'none';
  showControls();
});
video.addEventListener('ended', () => {
  iconPlay.style.display = '';
  iconPause.style.display = 'none';
  // 优先 NAS 列表，再本地列表
  if (state.nasFiles && state.nasIndex < state.nasFiles.length - 1) {
    const next = state.nasFiles[state.nasIndex + 1];
    playNasVideo(next, state.nasBaseUrl, state.nasFiles);
  } else if (state.currentIndex >= 0 && state.currentIndex < state.files.length - 1) {
    setTimeout(() => playVideo(state.currentIndex + 1), 800);
  }
});

// ==================== 进度条 ====================
video.addEventListener('timeupdate', () => {
  if (state.isSeeking || !video.duration) return;
  updateProgress();
});

video.addEventListener('durationchange', () => {
  state.duration = video.duration;
  timeTotal.textContent = formatTime(state.duration);
});

video.addEventListener('progress', () => {
  if (!video.duration) return;
  try {
    const buf = video.buffered;
    if (buf.length > 0) {
      const pct = (buf.end(buf.length - 1) / video.duration) * 100;
      progressBuf.style.width = pct + '%';
    }
  } catch (e) {}
});

function updateProgress() {
  if (!video.duration) return;
  const pct = (video.currentTime / video.duration) * 100;
  progressFill.style.width = pct + '%';
  progressThumb.style.left = pct + '%';
  timeCur.textContent = formatTime(video.currentTime);
}

// 进度条拖拽（触摸 & 鼠标）
let seekStartX = 0, seekStartTime = 0, seekBarWidth = 0;
let isSeekDragging = false; // 区分拖拽与点击

function onSeekStart(e) {
  e.preventDefault();
  e.stopPropagation();
  state.isSeeking = true;
  isSeekDragging = false;
  const touch = e.touches ? e.touches[0] : e;
  seekStartX = touch.clientX;
  seekBarWidth = progressBg.getBoundingClientRect().width;
  seekStartTime = video.currentTime;
  showControls();
}
function onSeekMove(e) {
  if (!state.isSeeking) return;
  const touch = e.touches ? e.touches[0] : e;
  const dx = touch.clientX - seekStartX;
  if (Math.abs(dx) > 2) isSeekDragging = true;
  const dtRatio = dx / seekBarWidth;
  const newTime = Math.max(0, Math.min(video.duration, seekStartTime + dtRatio * video.duration));
  video.currentTime = newTime;
  updateProgress();
}
function onSeekEnd(e) {
  state.isSeeking = false;
  scheduleHideControls();
}

// 点击跳转（只在非拖拽时触发）
progressBg.addEventListener('click', (e) => {
  if (isSeekDragging) { isSeekDragging = false; return; }
  e.stopPropagation();
  const rect = progressBg.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  video.currentTime = pct * video.duration;
  updateProgress();
});

progressBg.addEventListener('touchstart', onSeekStart, { passive: false });
progressBg.addEventListener('touchmove', onSeekMove, { passive: false });
progressBg.addEventListener('touchend', onSeekEnd);
progressBg.addEventListener('mousedown', onSeekStart);
document.addEventListener('mousemove', (e) => { if (state.isSeeking) onSeekMove(e); });
document.addEventListener('mouseup', (e) => { if (state.isSeeking) onSeekEnd(e); });

// ==================== 快进/快退 ====================
btnSkipBack.addEventListener('click', (e) => { e.stopPropagation(); skip(-10); });
btnSkipFwd.addEventListener('click', (e) => { e.stopPropagation(); skip(10); });

gestureLeft.addEventListener('click', (e) => { e.stopPropagation(); skip(-10); });
gestureRight.addEventListener('click', (e) => { e.stopPropagation(); skip(10); });

function skip(sec) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + sec));
  const hint = sec > 0 ? hintRight : hintLeft;
  hint.textContent = sec > 0 ? `+${sec}s` : `${sec}s`;
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 800);
  showBurst(sec > 0 ? '⏩' : '⏪');
  scheduleHideControls();
}

// 双击手势区快进/快退
let dblTapTimer = null, dblTapCount = 0;
[gestureLeft, gestureRight].forEach((el, idx) => {
  el.addEventListener('touchend', (e) => {
    e.preventDefault();
    dblTapCount++;
    if (dblTapCount === 1) {
      dblTapTimer = setTimeout(() => { dblTapCount = 0; }, 300);
    } else if (dblTapCount >= 2) {
      clearTimeout(dblTapTimer);
      dblTapCount = 0;
      skip(idx === 1 ? 10 : -10);
    }
  }, { passive: false });
});

// ==================== 倍速 ====================
btnSpeed.addEventListener('click', (e) => {
  e.stopPropagation();
  openPanel(speedPanel);
});

speedOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.speed-opt');
  if (!btn) return;
  const spd = parseFloat(btn.dataset.speed);
  setSpeed(spd);
  closeAllPanels();
});

function setSpeed(spd) {
  state.speed = spd;
  video.playbackRate = spd;
  speedLabel.textContent = spd === 1 ? '1×' : spd + '×';
  document.querySelectorAll('.speed-opt').forEach(o => {
    o.classList.toggle('active', parseFloat(o.dataset.speed) === spd);
  });
}

// ==================== 全屏 + 方向锁 ====================
btnFullscreen.addEventListener('click', (e) => {
  e.stopPropagation();
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).then(() => lockScreenOrientation()).catch(() => {});
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
});

function lockScreenOrientation() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      const type = state.videoIsPortrait ? 'portrait' : 'landscape';
      screen.orientation.lock(type).catch(() => {});
    }
  } catch (e) {}
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
function handleFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btnFullscreen.title = isFs ? '退出全屏' : '全屏';
  if (!isFs) {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) {}
  }
}

// ==================== 投屏 ====================
btnCast.addEventListener('click', (e) => {
  e.stopPropagation();
  openPanel(castPanel);
  startCastScan();
});
btnCloseCast.addEventListener('click', () => closeAllPanels());

function startCastScan() {
  castDevices.innerHTML = '';
  castScanning.style.display = 'flex';

  // AirPlay（iOS Safari）
  if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode('airplay')) {
    addCastDevice('📺', 'AirPlay 设备', 'Apple AirPlay', () => {
      video.webkitSetPresentationMode('airplay');
    });
  }

  // Remote Playback API（W3C 标准）
  if (window.RemotePlayback && video.remote) {
    addCastDevice('📡', '附近的设备', 'Miracast / DLNA', () => {
      video.remote.prompt().catch(() => {});
    });
  }

  // Chromecast
  if (window.cast && window.cast.framework) {
    initChromecast();
  }

  // 模拟设备（2秒后显示）
  setTimeout(() => {
    castScanning.style.display = 'none';
    if (castDevices.children.length === 0) {
      const mockDevices = [
        { icon: '📺', name: '客厅电视', type: 'DLNA / Smart TV' },
        { icon: '🖥️', name: '书房显示器', type: 'Miracast' },
      ];
      mockDevices.forEach(d => {
        addCastDevice(d.icon, d.name, d.type, () => connectToDevice(d.name));
      });
    }
  }, 2000);
}

function addCastDevice(icon, name, type, onClick) {
  const item = document.createElement('div');
  item.className = 'cast-device-item';
  item.innerHTML = `
    <div class="cast-device-icon">${icon}</div>
    <div>
      <div class="cast-device-name">${name}</div>
      <div class="cast-device-type">${type}</div>
    </div>
  `;
  item.addEventListener('click', onClick);
  castDevices.appendChild(item);
}

function connectToDevice(name) {
  state.isCasting = true;
  state.castDevice = name;
  castLabel.textContent = '投屏中';
  btnCast.classList.add('casting');
  document.querySelectorAll('.cast-device-item').forEach(el => {
    el.classList.toggle('connected', el.querySelector('.cast-device-name')?.textContent === name);
  });
  setTimeout(() => closeAllPanels(), 800);
}

function initChromecast() {
  try {
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (e) => {
        if (e.sessionState === cast.framework.SessionState.SESSION_STARTED) {
          const session = context.getCurrentSession();
          const mediaInfo = new chrome.cast.media.MediaInfo(video.src, 'video/mp4');
          const request = new chrome.cast.media.LoadRequest(mediaInfo);
          request.currentTime = video.currentTime;
          session.loadMedia(request);
          connectToDevice('Chromecast');
        }
      }
    );
    castScanning.style.display = 'none';
    addCastDevice('🟠', 'Chromecast', 'Google Cast', () => context.requestSession());
  } catch (e) {
    castScanning.style.display = 'none';
  }
}

// ==================== 控制栏自动隐藏 ====================
function showControls() {
  state.controlsVisible = true;
  playerTopbar.classList.remove('hidden-ui');
  playerControls.classList.remove('hidden-ui');
}

function hideControls() {
  if (video.paused) return;
  state.controlsVisible = false;
  playerTopbar.classList.add('hidden-ui');
  playerControls.classList.add('hidden-ui');
}

function scheduleHideControls() {
  showControls();
  clearTimeout(state.controlsTimer);
  state.controlsTimer = setTimeout(hideControls, state.uiHideDelay);
}

// video-wrap 点击切换控制栏（不包含控制区域）
videoWrap.addEventListener('click', (e) => {
  // 如果点击的是交互元素，跳过
  if (e.target.closest('.player-controls, .player-topbar, .gesture-left, .gesture-right, .center-tap')) {
    return;
  }
  if (state.controlsVisible) {
    hideControls();
    clearTimeout(state.controlsTimer);
  } else {
    scheduleHideControls();
  }
});

// ==================== 播放列表 ====================
function renderPlaylist() {
  playlistItems.innerHTML = '';
  state.files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'pl-item' + (i === state.currentIndex ? ' active' : '');
    item.innerHTML = `
      <div class="pl-thumb"><span style="font-size:18px;display:flex;align-items:center;justify-content:center;height:100%">🎬</span></div>
      <div class="pl-name">${file.name}</div>
    `;
    item.addEventListener('click', () => { playVideo(i); closeSidebar(); });
    playlistItems.appendChild(item);
  });
}

function highlightPlaylistItem() {
  document.querySelectorAll('.pl-item').forEach((el, i) => {
    el.classList.toggle('active', i === state.currentIndex);
  });
}

function closeSidebar() {
  playlistSidebar.classList.remove('open');
  overlay.classList.remove('active');
}
btnClosePlaylist.addEventListener('click', closeSidebar);

// ==================== 返回按钮 ====================
btnBack.addEventListener('click', (e) => {
  e.stopPropagation();
  video.pause();
  // 释放 blob URL
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
    video.src = '';
  }
  showPage('browser');
  closeAllPanels();
});

// 系统返回键（Android）
window.addEventListener('popstate', () => {
  if (pagePlayer.classList.contains('active')) {
    video.pause();
    showPage('browser');
  }
});

// ==================== 面板管理 ====================
function openPanel(panel) {
  closeAllPanels(false);
  panel.classList.add('open');
  overlay.classList.add('active');
}

function closeAllPanels(hideOverlay = true) {
  speedPanel.classList.remove('open');
  castPanel.classList.remove('open');
  playlistSidebar.classList.remove('open');
  if (hideOverlay) overlay.classList.remove('active');
}

overlay.addEventListener('click', () => closeAllPanels());

// ==================== 键盘快捷键（平板/桌面） ====================
document.addEventListener('keydown', (e) => {
  if (!pagePlayer.classList.contains('active')) return;
  switch (e.key) {
    case ' ':
      e.preventDefault(); togglePlay(); break;
    case 'ArrowRight':
      skip(10); break;
    case 'ArrowLeft':
      skip(-10); break;
    case 'ArrowUp':
      video.volume = Math.min(1, video.volume + 0.1); break;
    case 'ArrowDown':
      video.volume = Math.max(0, video.volume - 0.1); break;
    case 'f': case 'F':
      btnFullscreen.click(); break;
    case 'Escape':
      video.pause(); showPage('browser'); break;
  }
});

// ==================== 横向滑动调进度 ====================
let touchStartX = 0, touchStartY = 0, touchStartVidTime = 0, isHSwipe = false;

videoWrap.addEventListener('touchstart', (e) => {
  if (e.target.closest('.player-controls, .player-topbar, .progress-bar-bg')) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartVidTime = video.currentTime;
  isHSwipe = false;
}, { passive: true });

videoWrap.addEventListener('touchmove', (e) => {
  if (e.target.closest('.player-controls, .player-topbar, .progress-bar-bg')) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;

  if (!isHSwipe && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    isHSwipe = true;
  }
  if (isHSwipe && video.duration) {
    e.preventDefault();
    const seekDelta = (dx / window.innerWidth) * video.duration * 0.4;
    const newTime = Math.max(0, Math.min(video.duration, touchStartVidTime + seekDelta));
    video.currentTime = newTime;
    const hint = dx > 0 ? hintRight : hintLeft;
    const delta = Math.abs(Math.round(seekDelta));
    hint.textContent = (dx > 0 ? '+' : '-') + formatTime(delta);
    hint.classList.add('show');
    updateProgress();
    scheduleHideControls();
  }
}, { passive: false });

videoWrap.addEventListener('touchend', () => {
  isHSwipe = false;
  setTimeout(() => {
    hintLeft.classList.remove('show');
    hintRight.classList.remove('show');
  }, 600);
});

// ==================== RMVB 格式提示 ====================
function showRmvbWarning(count) {
  const toast = document.createElement('div');
  toast.className = 'rmvb-toast';
  toast.innerHTML = `
    <div class="rmvb-toast-icon">✅</div>
    <div class="rmvb-toast-body">
      <div class="rmvb-toast-title">发现 ${count} 个特殊格式文件</div>
      <div class="rmvb-toast-desc">RMVB/RM 等格式将通过原生播放器播放（仅 APK 版本支持）</div>
      <div class="rmvb-toast-actions">
        <button class="rmvb-btn" onclick="this.closest('.rmvb-toast').remove()">知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 6000);
}

// ==================== NAS 读取 ====================
const btnNas = $('btn-nas');
const nasUrlInput = $('nas-url-input');

btnNas.addEventListener('click', () => {
  const url = prompt('输入 NAS 视频目录的 HTTP 地址\n（需要先运行 VideoX NAS 服务端）', state.nasUrl || 'http://');
  if (!url) return;
  state.nasUrl = url;
  loadNasFiles(url);
});

async function loadNasFiles(baseUrl) {
  try {
    scanBanner.classList.add('hidden');
    fileList.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>正在从 NAS 读取...</p></div>';

    // 尝试获取文件列表（期望返回 JSON）
    const resp = await fetch(baseUrl + '/list', { mode: 'cors' });
    if (!resp.ok) throw new Error('无法连接 NAS 服务');
    const data = await resp.json();
    // data 格式：{ files: [{ name, size, path }] }
    if (!data.files || data.files.length === 0) {
      fileList.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>NAS 目录为空</p></div>';
      return;
    }
    renderNasFiles(data.files, baseUrl);
  } catch (e) {
    // 如果 /list 接口不存在，提示用户运行服务端
    fileList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌐</div>
        <p>无法连接 NAS 服务</p>
        <small>请在 NAS 上运行 VideoX 服务端，或使用「选择文件夹」</small>
        <br/><br/>
        <button class="btn-primary" onclick="location.reload()">刷新重试</button>
      </div>`;
  }
}

function renderNasFiles(files, baseUrl) {
  fileList.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = `NAS 文件（${files.length}）`;
  fileList.appendChild(label);

  files.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item video-item';
    item.innerHTML = `
      <div class="file-icon">🎬</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${formatSize(f.size)}</div>
      </div>
      <span class="file-arrow">▶</span>
    `;
    item.addEventListener('click', () => playNasVideo(f, baseUrl, files));
    fileList.appendChild(item);
  });
}

async function playNasVideo(file, baseUrl, allFiles) {
  if (isRmvbFile(file.name)) {
    alert('⚠️ RMVB 格式不支持\n浏览器无法播放 RMVB/RM 格式，请先转码为 MP4');
    return;
  }
  showPage('player');
  videoTitle.textContent = file.name;
  document.title = file.name + ' — VideoX';
  video.src = baseUrl + '/file?path=' + encodeURIComponent(file.path);
  video.load();
  video.play().catch(() => {});
  state.nasFiles = allFiles;
  state.nasBaseUrl = baseUrl;
  state.nasIndex = allFiles.findIndex(f => f.path === file.path);
  scheduleHideControls();
}

// ==================== 初始化 ====================
(function init() {
  state.showHidden = true;
  btnToggleHidden.classList.add('active');
  hiddenLabel.textContent = '隐藏中';

  // 阻止视频右键/长按菜单
  video.addEventListener('contextmenu', e => e.preventDefault());

  // 初始应用适应模式
  applyFitMode();

  // 推入历史状态（支持 Android 返回键）
  history.pushState({ page: 'browser' }, '');

  console.log('[VideoX] 初始化完成 — 支持隐藏文件夹扫描 · 倍速播放 · 投屏 · 竖/横屏自适应');
})();
