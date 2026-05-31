/* ===== app.js — VideoX 视频播放器（播放器优先 + 文件管理） ===== */
'use strict';

// ==================== 状态管理 ====================
const state = {
  files: [],              // 所有视频文件（File 对象）
  folderStructure: {},    // 文件夹结构 { path: { folders: Set, files: [] } }
  currentIndex: -1,
  showHidden: true,
  speed: 1,
  duration: 0,
  isSeeking: false,
  controlsVisible: true,
  fitMode: 'contain',
  viewMode: 'flat',       // 'flat' | 'tree'
  selectMode: false,
  selectedIndices: new Set(),
  videoIsPortrait: false,
  videoWidth: 0,
  videoHeight: 0,
  nasFiles: null,
  nasBaseUrl: '',
  nasIndex: -1,
  folderStack: [],
  expandedFolders: new Set(), // 树形视图展开的文件夹
};

// ==================== DOM 获取 ====================
const $ = id => document.getElementById(id);

// 浏览器页
const pageBrowser       = $('page-browser');
const fileList          = $('file-list');
const breadcrumb        = $('breadcrumb');
const emptyGuide        = $('empty-guide');
const statsBar          = $('stats-bar');
const statsCount        = $('stats-count');
const selectBar         = $('select-bar');
const btnOpenFiles      = $('btn-open-files');
const btnOpenFolder     = $('btn-open-folder');
const btnViewFlat       = $('btn-view-flat');
const btnViewTree       = $('btn-view-tree');
const btnToggleHidden   = $('btn-toggle-hidden');
const btnSelectAll      = $('btn-select-all');
const btnSelectInvert   = $('btn-select-invert');
const btnSelectCancel   = $('btn-select-cancel');
const btnSelectDelete   = $('btn-select-delete');
const fileInput         = $('file-input');
const folderInput       = $('folder-input');

// 播放器页
const pagePlayer       = $('page-player');
const video            = $('main-video');
const videoTitle       = $('video-title');
const playerTopbar     = $('player-topbar');
const playerControls   = $('player-controls');
const centerTap        = $('center-tap');
const gestureLeft      = $('gesture-left');
const gestureRight     = $('gesture-right');
const hintLeft         = $('hint-left');
const hintRight        = $('hint-right');
const playAnim         = $('play-anim');
const videoWrap        = $('video-wrap');
const btnBack          = $('btn-back');
const btnCast          = $('btn-cast');
const castLabel        = $('cast-label');
const btnPlayPause     = $('btn-play-pause');
const iconPlay         = $('icon-play');
const iconPause        = $('icon-pause');
const btnSkipBack      = $('btn-skip-back');
const btnSkipFwd       = $('btn-skip-fwd');
const btnSpeed         = $('btn-speed');
const speedLabel       = $('speed-label');
const btnFullscreen    = $('btn-fullscreen');
const btnFit           = $('btn-fit');
const fitLabel         = $('fit-label');
const fitIconContain   = $('fit-icon-contain');
const fitIconCover     = $('fit-icon-cover');
const fitIconRotate    = $('fit-icon-rotate');
const orientBadge      = $('orient-badge');
const orientBar        = $('orientation-bar');
const orientBarText    = $('orientation-bar-text');
const timeCur          = $('time-cur');
const timeTotal        = $('time-total');
const progressBg       = $('progress-bg');
const progressFill     = $('progress-fill');
const progressBuf      = $('progress-buf');
const progressThumb    = $('progress-thumb');
const speedPanel       = $('speed-panel');
const speedOptions     = $('speed-options');
const castPanel        = $('cast-panel');
const castDevices      = $('cast-devices');
const btnCloseCast     = $('btn-close-cast');
const castScanning     = $('cast-scanning');
const playlistSidebar  = $('playlist-sidebar');
const playlistItems    = $('playlist-items');
const btnClosePlaylist = $('btn-close-playlist');
const overlay          = $('overlay');

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

function needsNativePlayer(name) {
  return /\.(rmvb|rm|wmv|asf|vob|evo|divx|xvid|ogv|ogm)$/i.test(name);
}

function isHidden(name) {
  return name.startsWith('.');
}

function showBurst(icon) {
  playAnim.textContent = icon;
  playAnim.classList.remove('burst');
  void playAnim.offsetWidth;
  playAnim.classList.add('burst');
}

// ==================== 页面切换 ====================
function showPage(name) {
  pageBrowser.classList.toggle('active', name === 'browser');
  pagePlayer.classList.toggle('active', name === 'player');
  if (name === 'browser') {
    document.title = 'VideoX — 极速播放器';
  }
}

// ==================== 累积导入文件 ====================
function importFiles(fileArray, mode) {
  // mode: 'replace' (default first-time) | 'append' (追加)
  const isFirst = state.files.length === 0 || mode === 'replace';
  const existing = new Set(state.files.map(f => f.name + '|' + f.size));

  const structure = isFirst ? {} : state.folderStructure;
  const allVideos = isFirst ? [] : [...state.files];

  let addedCount = 0;

  fileArray.forEach(file => {
    const parts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const dirPath = dirParts.length > 0 ? dirParts.join('/') : 'root';

    // 注册目录
    for (let i = 0; i <= dirParts.length; i++) {
      const parentPath = i === 0 ? 'root' : dirParts.slice(0, i).join('/');
      const childName = dirParts[i];
      if (!structure[parentPath]) structure[parentPath] = { folders: new Set(), files: [] };
      if (childName) structure[parentPath].folders.add(childName);
    }

    if (!structure[dirPath]) structure[dirPath] = { folders: new Set(), files: [] };

    if (!isVideoFile(fileName)) return;

    // 去重
    const key = fileName + '|' + file.size;
    if (existing.has(key)) return;
    existing.add(key);

    file._dir = dirPath;
    structure[dirPath].files.push(file);
    allVideos.push(file);
    addedCount++;
  });

  state.files = allVideos;
  state.folderStructure = structure;
  state.folderStack = [];
  state.expandedFolders = new Set();

  // 树形视图展开所有有内容的根目录
  if (state.viewMode === 'tree' && structure['root']) {
    structure['root'].folders.forEach(f => state.expandedFolders.add('root/' + f));
  }

  updateStats();
  refreshView();

  if (addedCount > 0 && !isFirst) {
    showToast(`已添加 ${addedCount} 个视频`, 'success');
  }

  if (allVideos.length === 0) {
    fileList.innerHTML = '';
    emptyGuide.style.display = '';
    statsBar.style.display = 'none';
    selectBar.classList.remove('active');
  }
}

function refreshView() {
  if (state.files.length === 0) {
    fileList.innerHTML = '';
    emptyGuide.style.display = '';
    statsBar.style.display = 'none';
    selectBar.classList.remove('active');
    return;
  }

  emptyGuide.style.display = 'none';
  statsBar.style.display = 'flex';
  renderBreadcrumb('root');

  if (state.viewMode === 'flat') {
    renderFlatView();
  } else {
    renderTreeView();
  }

  if (state.selectMode) {
    selectBar.classList.add('active');
  }
}

function updateStats() {
  const count = state.files.length;
  if (count === 0) {
    statsCount.textContent = '未导入视频';
    return;
  }
  let totalSize = 0;
  state.files.forEach(f => { totalSize += f.size || 0; });
  statsCount.textContent = `共 ${count} 个视频 · ${formatSize(totalSize)}`;
}

// ==================== 平铺视图（全部视频平铺，显示文件夹路径） ====================
function renderFlatView() {
  fileList.innerHTML = '';
  btnViewFlat.classList.add('active');
  btnViewTree.classList.remove('active');

  if (state.files.length === 0) return;

  // 按文件夹分组但平铺展示
  const structure = state.folderStructure;
  const rootEntry = structure['root'] || { folders: new Set(), files: [] };
  let hasContent = false;

  // 先渲染根目录下的视频
  if (rootEntry.files.length > 0) {
    renderSectionHeader(fileList, `全部视频 · ${rootEntry.files.length}`, 'root');
    rootEntry.files.forEach(file => renderVideoItem(file, state.files.indexOf(file)));
    hasContent = true;
  }

  // 递归渲染子目录视频（平铺但带路径）
  function renderDirVideos(dirPath, depth) {
    const entry = structure[dirPath];
    if (!entry) return;
    const dirName = dirPath === 'root' ? '' : dirPath.split('/').pop();
    if (isHidden(dirName) && !state.showHidden) {
      // 仍递归子目录
      entry.folders.forEach(f => {
        const subPath = dirPath === 'root' ? f : `${dirPath}/${f}`;
        renderDirVideos(subPath, depth);
      });
      return;
    }

    if (entry.files.length > 0 && dirPath !== 'root') {
      renderSectionHeader(fileList, `📁 ${dirPath} · ${entry.files.length}`, dirPath);
      entry.files.forEach(file => renderVideoItem(file, state.files.indexOf(file)));
      hasContent = true;
    }

    entry.folders.forEach(f => {
      const subPath = dirPath === 'root' ? f : `${dirPath}/${f}`;
      renderDirVideos(subPath, depth + 1);
    });
  }

  if (rootEntry.folders.size > 0) {
    rootEntry.folders.forEach(f => {
      const subPath = 'root/' + f;
      renderDirVideos(subPath, 1);
    });
  }

  if (!hasContent) {
    fileList.innerHTML = '<div class="empty-state"><p>没有符合条件的视频</p></div>';
  }
}

function renderSectionHeader(parent, text, path) {
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = text;
  parent.appendChild(label);
}

function renderVideoItem(file, index) {
  const item = document.createElement('div');
  item.className = 'file-item video-item' + (state.selectMode ? ' selectable' : '');
  if (state.selectedIndices.has(index)) item.classList.add('selected');

  const isNative = needsNativePlayer(file.name);

  item.innerHTML = `
    ${state.selectMode ? `<div class="select-check" data-idx="${index}"><div class="check-box">✓</div></div>` : ''}
    <div class="file-icon">${isNative ? '🎞️' : '🎬'}</div>
    <div class="file-info">
      <div class="file-name">${file.name}</div>
      <div class="file-meta">${formatSize(file.size)}${file._dir && file._dir !== 'root' ? ` · ${file._dir}` : ''}</div>
    </div>
    <span class="file-arrow">▶</span>
  `;

  item.addEventListener('click', (e) => {
    if (state.selectMode) {
      // 多选模式下，点击复选框区域切换选择
      const checkEl = e.target.closest('.select-check');
      if (checkEl) {
        e.stopPropagation();
        toggleFileSelect(index, item);
        return;
      }
      toggleFileSelect(index, item);
      return;
    }
    playVideo(index);
  });

  item.addEventListener('long-press', () => {
    if (!state.selectMode) enterSelectMode();
    toggleFileSelect(index, item);
  });

  fileList.appendChild(item);
  return item;
}

// ==================== 树形视图（可展开折叠） ====================
function renderTreeView() {
  fileList.innerHTML = '';
  btnViewTree.classList.add('active');
  btnViewFlat.classList.remove('active');

  const structure = state.folderStructure;
  if (Object.keys(structure).length === 0) return;

  const rootEntry = structure['root'] || { folders: new Set(), files: [] };

  // 根目录下的视频
  if (rootEntry.files.length > 0) {
    rootEntry.files.forEach(file => renderVideoItem(file, state.files.indexOf(file)));
  }

  // 子文件夹
  const allFolders = [...rootEntry.folders].sort();
  const visibleFolders = state.showHidden ? allFolders : allFolders.filter(f => !isHidden(f));

  visibleFolders.forEach(folderName => {
    const folderPath = `root/${folderName}`;
    renderTreeFolder(folderPath, folderName, 0);
  });

  if (rootEntry.files.length === 0 && visibleFolders.length === 0) {
    fileList.innerHTML = '<div class="empty-state"><p>没有符合条件的视频</p></div>';
  }

  // 隐藏文件夹提示
  if (!state.showHidden) {
    const hiddenCount = allFolders.length - visibleFolders.length;
    if (hiddenCount > 0) {
      const tip = document.createElement('div');
      tip.className = 'hidden-folder-tip';
      tip.textContent = `🔒 还有 ${hiddenCount} 个隐藏文件夹`;
      fileList.appendChild(tip);
    }
  }
}

function renderTreeFolder(folderPath, folderName, depth) {
  const structure = state.folderStructure;
  const entry = structure[folderPath] || { folders: new Set(), files: [] };
  const totalVideos = countVideosInTree(folderPath);
  const isExpanded = state.expandedFolders.has(folderPath);
  const hidden = isHidden(folderName);

  const item = document.createElement('div');
  item.className = 'file-item folder-item tree-node';
  item.style.paddingLeft = (16 + depth * 20) + 'px';

  item.innerHTML = `
    <div class="file-icon tree-arrow">${isExpanded ? '▼' : '▶'}</div>
    <div class="file-icon">${hidden ? '🔒' : '📁'}</div>
    <div class="file-info">
      <div class="file-name">${folderName}</div>
      <div class="file-meta">${totalVideos} 个视频</div>
    </div>
  `;

  item.addEventListener('click', () => {
    if (isExpanded) {
      state.expandedFolders.delete(folderPath);
    } else {
      state.expandedFolders.add(folderPath);
    }
    refreshView();
  });

  fileList.appendChild(item);

  if (!isExpanded) return;

  // 展开：显示子文件夹和视频
  const subFolders = [...entry.folders].sort();
  const visibleSubFolders = state.showHidden ? subFolders : subFolders.filter(f => !isHidden(f));

  visibleSubFolders.forEach(subName => {
    const subPath = folderPath + '/' + subName;
    renderTreeFolder(subPath, subName, depth + 1);
  });

  entry.files.forEach(file => {
    const idx = state.files.indexOf(file);
    const videoItem = renderVideoItem(file, idx);
    videoItem.style.paddingLeft = (16 + (depth + 1) * 20) + 'px';
  });
}

function countVideosInTree(path) {
  const structure = state.folderStructure;
  const entry = structure[path];
  if (!entry) return 0;
  let count = entry.files.length;
  entry.folders.forEach(f => {
    const subPath = path + '/' + f;
    count += countVideosInTree(subPath);
  });
  return count;
}

// ==================== 面包屑（树形视图用） ====================
function renderBreadcrumb(currentPath) {
  breadcrumb.innerHTML = '';

  const rootItem = document.createElement('span');
  rootItem.className = 'bc-item';
  rootItem.textContent = '📁 全部视频';
  rootItem.addEventListener('click', () => {
    state.folderStack = [];
    state.expandedFolders = new Set();
    // 展开根目录
    const rootEntry = state.folderStructure['root'];
    if (rootEntry) {
      rootEntry.folders.forEach(f => state.expandedFolders.add('root/' + f));
    }
    refreshView();
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
    if (i === parts.length - 1) {
      item.classList.add('active');
    }
    breadcrumb.appendChild(item);
  });
}

// ==================== 多选功能 ====================
function enterSelectMode() {
  state.selectMode = true;
  selectBar.classList.add('active');
  refreshView();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedIndices.clear();
  selectBar.classList.remove('active');
  refreshView();
}

function toggleFileSelect(index, itemEl) {
  if (state.selectedIndices.has(index)) {
    state.selectedIndices.delete(index);
    if (itemEl) itemEl.classList.remove('selected');
  } else {
    state.selectedIndices.add(index);
    if (itemEl) itemEl.classList.add('selected');
  }

  if (state.selectedIndices.size === 0) {
    exitSelectMode();
  }
}

btnSelectAll.addEventListener('click', () => {
  state.files.forEach((_, i) => state.selectedIndices.add(i));
  refreshView();
});

btnSelectInvert.addEventListener('click', () => {
  const newSet = new Set();
  state.files.forEach((_, i) => {
    if (!state.selectedIndices.has(i)) newSet.add(i);
  });
  state.selectedIndices = newSet;
  if (state.selectedIndices.size === 0) exitSelectMode();
  else refreshView();
});

btnSelectCancel.addEventListener('click', exitSelectMode);

btnSelectDelete.addEventListener('click', () => {
  const count = state.selectedIndices.size;
  if (count === 0) return;
  if (!confirm(`确定要从列表中移除 ${count} 个视频吗？（不会删除原文件）`)) return;

  // 从后往前删，避免索引变化
  const sorted = [...state.selectedIndices].sort((a, b) => b - a);
  sorted.forEach(idx => state.files.splice(idx, 1));

  // 重建 folderStructure
  rebuildStructure();

  state.selectedIndices.clear();
  state.currentIndex = -1;
  exitSelectMode();
  updateStats();
  refreshView();
});

function rebuildStructure() {
  const structure = {};
  state.files.forEach(file => {
    const dirPath = file._dir || 'root';
    const parts = dirPath === 'root' ? [] : dirPath.split('/');

    for (let i = 0; i <= parts.length; i++) {
      const parentPath = i === 0 ? 'root' : parts.slice(0, i).join('/');
      const childName = parts[i];
      if (!structure[parentPath]) structure[parentPath] = { folders: new Set(), files: [] };
      if (childName) structure[parentPath].folders.add(childName);
    }

    if (!structure[dirPath]) structure[dirPath] = { folders: new Set(), files: [] };
    structure[dirPath].files.push(file);
  });
  state.folderStructure = structure;
}

// 长按检测
(function setupLongPress() {
  let pressTimer = null;
  let pressTarget = null;

  fileList.addEventListener('touchstart', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    pressTarget = item;
    pressTimer = setTimeout(() => {
      const event = new CustomEvent('long-press');
      pressTarget.dispatchEvent(event);
      pressTimer = null;
    }, 500);
  }, { passive: true });

  fileList.addEventListener('touchend', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  });
  fileList.addEventListener('touchmove', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  });
})();

// ==================== 视图切换 ====================
btnViewFlat.addEventListener('click', () => {
  state.viewMode = 'flat';
  refreshView();
});

btnViewTree.addEventListener('click', () => {
  state.viewMode = 'tree';
  // 初次切换到树形，展开根目录
  const rootEntry = state.folderStructure['root'];
  if (rootEntry && state.expandedFolders.size === 0) {
    rootEntry.folders.forEach(f => state.expandedFolders.add('root/' + f));
  }
  refreshView();
});

// ==================== 显示/隐藏隐藏文件夹 ====================
btnToggleHidden.addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  btnToggleHidden.classList.toggle('active', state.showHidden);
  refreshView();
});

// ==================== 打开视频文件（多选） ====================
btnOpenFiles.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  importFiles(files, 'append');
  fileInput.value = '';
});

// ==================== 导入文件夹 ====================
btnOpenFolder.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  importFiles(files, state.files.length > 0 ? 'append' : 'replace');
  folderInput.value = '';
});

// ==================== Toast 提示 ====================
function showToast(msg, type) {
  const toast = document.createElement('div');
  toast.className = 'mini-toast ' + (type || '');
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ==================== 处理外部 Intent 视频（小米"其它应用打开"） ====================
// 核心方案：通过 Android WebView.addJavascriptInterface（__videoXBridge）获取视频路径
// 这比 evaluateJavascript 可靠得多 — addJavascriptInterface 在页面加载前就已注入
//
// 流程：
//   1. app.js 加载 → init() 启动轮询 __videoXBridge
//   2. MainActivity 已通过 addJavascriptInterface 注入 bridge 对象
//   3. bridge 返回 pendingVideoPath / pendingVideoName（由 Activity 设置）
//   4. handleExternalVideo 直接进入播放器 — 跳过浏览器页面

window.handleExternalVideo = function(path, name) {
  console.log('[VideoX] 外部视频:', name, '路径:', path);

  // DOM 守卫：播放器页面元素必须存在
  if (!pagePlayer || !video) {
    console.warn('[VideoX] DOM 未就绪，200ms 后重试...');
    setTimeout(() => window.handleExternalVideo(path, name), 200);
    return;
  }

  // 创建伪 File 对象
  const fakeFile = {
    name: name,
    size: 0,
    path: path,
    _dir: 'root',
    lastModified: Date.now(),
  };

  // 去重
  let existingIdx = state.files.findIndex(f => f.path === path);
  if (existingIdx < 0) {
    state.files.push(fakeFile);
    if (!state.folderStructure['root']) {
      state.folderStructure['root'] = { folders: new Set(), files: [] };
    }
    state.folderStructure['root'].files.push(fakeFile);
    existingIdx = state.files.length - 1;
  }

  // 后台更新统计（不渲染浏览器页面）
  updateStats();

  // 直接进入播放器
  playVideo(existingIdx);
};

// 轮询 __videoXBridge，检查是否有外部视频
function pollExternalVideoBridge(attempt) {
  if (attempt > 15) return; // 最多 4.5 秒

  try {
    const bridge = window.__videoXBridge;
    if (bridge) {
      const path = bridge.getPendingVideoPath();
      const name = bridge.getPendingVideoName();
      if (path && name) {
        console.log('[VideoX] Bridge 轮询成功 (attempt ' + attempt + ')');
        handleExternalVideo(path, name);
        return; // 成功，停止轮询
      }
    }
  } catch (e) {
    console.warn('[VideoX] Bridge 读取异常:', e.message);
  }

  setTimeout(() => pollExternalVideoBridge(attempt + 1), 300);
}

// ==================== 播放视频 ====================
function playVideo(index) {
  if (index < 0 || index >= state.files.length) return;

  // 防御：播放器 DOM 还没加载好（外部 Intent 最早触发时可能出现）
  if (!pagePlayer || !video || !videoTitle) {
    setTimeout(() => playVideo(index), 200);
    return;
  }

  state.currentIndex = index;
  const file = state.files[index];

  // 退出多选模式
  if (state.selectMode) exitSelectMode();

  // 检测是否需要原生播放器
  if (needsNativePlayer(file.name)) {
    playNative(file);
    return;
  }

  // 释放上一个 blob URL
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }

  // 尝试使用 path 直接播放（外部 intent 文件的缓存路径）
  if (file.path && file.path.startsWith('/') && !(file instanceof File)) {
    // 使用 Capacitor local server URL
    const Capacitor = window.Capacitor;
    if (Capacitor && Capacitor.convertFileSrc) {
      video.src = Capacitor.convertFileSrc(file.path);
    } else {
      video.src = 'file://' + file.path;
    }
  } else if (file instanceof File) {
    video.src = URL.createObjectURL(file);
  } else {
    video.src = URL.createObjectURL(new Blob([]));
  }

  video.playbackRate = state.speed;
  videoTitle.textContent = file.name;
  document.title = file.name + ' — VideoX';

  showPage('player');
  video.load();
  video.play().catch(() => {});

  renderPlaylist();
  highlightPlaylistItem();
  scheduleHideControls();
}

// ==================== 原生播放器（Capacitor 插件） ====================
async function playNative(file) {
  try {
    const { VideoXPlayer } = window.Capacitor?.Plugins || {};
    if (VideoXPlayer) {
      const filePath = file.path || file.webkitRelativePath || '';
      await VideoXPlayer.play({ path: filePath, name: file.name });
    } else {
      alert('⚠️ ' + file.name + '\n\n此格式需要原生播放器支持\n请在 APK 中运行此功能');
    }
  } catch (e) {
    console.warn('[VideoX] 原生播放器不可用:', e.message);
    alert('⚠️ ' + file.name + '\n\n需要原生播放器（仅 APK 版本支持）');
  }
}

// ==================== 视频方向检测 ====================
video.addEventListener('loadeddata', () => { detectVideoOrientation(); });
video.addEventListener('loadedmetadata', () => {
  detectVideoOrientation();
  state.duration = video.duration;
  timeTotal.textContent = formatTime(state.duration);
});

function detectVideoOrientation() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  state.videoWidth = w;
  state.videoHeight = h;
  state.videoIsPortrait = h > w;
  const label = state.videoIsPortrait ? `竖屏 ${w}×${h}` : `横屏 ${w}×${h}`;
  orientBadge.textContent = label;
  state.fitMode = 'contain';
  applyFitMode();
}

// ==================== 适应模式 ====================
const FIT_MODES_ALL = ['contain', 'cover', 'rotate'];
const FIT_MODES_LANDSCAPE = ['contain', 'cover'];
const FIT_LABELS = { contain: '适应', cover: '填充', rotate: '旋转' };
const FIT_TIPS = {
  contain: '适应模式：保留黑边，完整显示',
  cover: '填充模式：裁切边缘，铺满屏幕',
  rotate: '旋转模式：竖屏视频旋转为横屏',
};

function applyFitMode() {
  const mode = state.fitMode;
  const wrap = videoWrap;
  wrap.classList.remove('fit-cover', 'rotated', 'portrait-video', 'landscape-video');
  if (state.videoIsPortrait) wrap.classList.add('portrait-video');
  else wrap.classList.add('landscape-video');
  if (mode === 'cover') wrap.classList.add('fit-cover');
  else if (mode === 'rotate' && state.videoIsPortrait) wrap.classList.add('rotated');
  fitIconContain.style.display = mode === 'contain' ? '' : 'none';
  fitIconCover.style.display = mode === 'cover' ? '' : 'none';
  fitIconRotate.style.display = mode === 'rotate' ? '' : 'none';
  fitLabel.textContent = FIT_LABELS[mode];
  orientBarText.textContent = FIT_TIPS[mode];
  orientBar.classList.add('show');
  clearTimeout(state.orientBarTimer);
  state.orientBarTimer = setTimeout(() => orientBar.classList.remove('show'), 2000);
}

btnFit.addEventListener('click', () => {
  const modes = state.videoIsPortrait ? FIT_MODES_ALL : FIT_MODES_LANDSCAPE;
  const curIdx = modes.indexOf(state.fitMode);
  state.fitMode = modes[(curIdx + 1) % modes.length];
  applyFitMode();
  scheduleHideControls();
});

function onOrientationChange() { setTimeout(() => applyFitMode(), 150); }
window.addEventListener('orientationchange', onOrientationChange);
window.addEventListener('resize', onOrientationChange);

// ==================== 播放/暂停 ====================
function togglePlay() {
  if (video.paused) { video.play().catch(() => {}); showBurst('▶'); }
  else { video.pause(); showBurst('⏸'); }
}

btnPlayPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
centerTap.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });

video.addEventListener('play', () => {
  iconPlay.style.display = 'none'; iconPause.style.display = '';
  scheduleHideControls();
});
video.addEventListener('pause', () => {
  iconPlay.style.display = ''; iconPause.style.display = 'none';
  showControls();
});
video.addEventListener('ended', () => {
  iconPlay.style.display = ''; iconPause.style.display = 'none';
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
      progressBuf.style.width = (buf.end(buf.length - 1) / video.duration) * 100 + '%';
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

let seekStartX = 0, seekStartTime = 0, seekBarWidth = 0, isSeekDragging = false;

function onSeekStart(e) {
  e.preventDefault(); e.stopPropagation();
  state.isSeeking = true; isSeekDragging = false;
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
  video.currentTime = Math.max(0, Math.min(video.duration, seekStartTime + (dx / seekBarWidth) * video.duration));
  updateProgress();
}
function onSeekEnd() { state.isSeeking = false; scheduleHideControls(); }

progressBg.addEventListener('click', (e) => {
  if (isSeekDragging) { isSeekDragging = false; return; }
  e.stopPropagation();
  const rect = progressBg.getBoundingClientRect();
  video.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * video.duration;
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

// 双击
let dblTapTimer = null, dblTapCount = 0;
[gestureLeft, gestureRight].forEach((el, idx) => {
  el.addEventListener('touchend', (e) => {
    e.preventDefault(); dblTapCount++;
    if (dblTapCount === 1) { dblTapTimer = setTimeout(() => { dblTapCount = 0; }, 300); }
    else if (dblTapCount >= 2) {
      clearTimeout(dblTapTimer); dblTapCount = 0;
      skip(idx === 1 ? 10 : -10);
    }
  }, { passive: false });
});

// ==================== 倍速 ====================
btnSpeed.addEventListener('click', (e) => { e.stopPropagation(); openPanel(speedPanel); });
speedOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.speed-opt');
  if (!btn) return;
  setSpeed(parseFloat(btn.dataset.speed));
  closeAllPanels();
});

function setSpeed(spd) {
  state.speed = spd; video.playbackRate = spd;
  speedLabel.textContent = spd === 1 ? '1×' : spd + '×';
  document.querySelectorAll('.speed-opt').forEach(o => {
    o.classList.toggle('active', parseFloat(o.dataset.speed) === spd);
  });
}

// ==================== 全屏 ====================
btnFullscreen.addEventListener('click', (e) => {
  e.stopPropagation();
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el).then(() => lockScreenOrientation()).catch(() => {});
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
});

function lockScreenOrientation() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock(state.videoIsPortrait ? 'portrait' : 'landscape').catch(() => {});
    }
  } catch (e) {}
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
function handleFullscreenChange() {
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  }
}

// ==================== 投屏 ====================
btnCast.addEventListener('click', (e) => { e.stopPropagation(); openPanel(castPanel); startCastScan(); });
btnCloseCast.addEventListener('click', () => closeAllPanels());

function startCastScan() {
  castDevices.innerHTML = '';
  castScanning.style.display = 'flex';
  if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode('airplay')) {
    addCastDevice('📺', 'AirPlay 设备', 'Apple AirPlay', () => video.webkitSetPresentationMode('airplay'));
  }
  if (window.RemotePlayback && video.remote) {
    addCastDevice('📡', '附近的设备', 'Miracast / DLNA', () => video.remote.prompt().catch(() => {}));
  }
  setTimeout(() => {
    castScanning.style.display = 'none';
    if (castDevices.children.length === 0) {
      addCastDevice('📺', '客厅电视', 'DLNA / Smart TV', () => connectToDevice('客厅电视'));
      addCastDevice('🖥️', '书房显示器', 'Miracast', () => connectToDevice('书房显示器'));
    }
  }, 2000);
}

function addCastDevice(icon, name, type, onClick) {
  const item = document.createElement('div');
  item.className = 'cast-device-item';
  item.innerHTML = `<div class="cast-device-icon">${icon}</div><div><div class="cast-device-name">${name}</div><div class="cast-device-type">${type}</div></div>`;
  item.addEventListener('click', onClick);
  castDevices.appendChild(item);
}

function connectToDevice(name) {
  state.isCasting = true; state.castDevice = name;
  castLabel.textContent = '投屏中'; btnCast.classList.add('casting');
  setTimeout(() => closeAllPanels(), 800);
}

// ==================== 控制栏 ====================
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
  state.controlsTimer = setTimeout(hideControls, 3500);
}

videoWrap.addEventListener('click', (e) => {
  if (e.target.closest('.player-controls, .player-topbar, .gesture-left, .gesture-right, .center-tap')) return;
  if (state.controlsVisible) { hideControls(); clearTimeout(state.controlsTimer); }
  else scheduleHideControls();
});

// ==================== 播放列表 ====================
function renderPlaylist() {
  playlistItems.innerHTML = '';
  state.files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'pl-item' + (i === state.currentIndex ? ' active' : '');
    item.innerHTML = `<div class="pl-thumb"><span style="font-size:18px;display:flex;align-items:center;justify-content:center;height:100%">🎬</span></div><div class="pl-name">${file.name}</div>`;
    item.addEventListener('click', () => { playVideo(i); closeSidebar(); });
    playlistItems.appendChild(item);
  });
}
function highlightPlaylistItem() {
  document.querySelectorAll('.pl-item').forEach((el, i) => el.classList.toggle('active', i === state.currentIndex));
}
function closeSidebar() { playlistSidebar.classList.remove('open'); overlay.classList.remove('active'); }
btnClosePlaylist.addEventListener('click', closeSidebar);

// ==================== 返回 ====================
btnBack.addEventListener('click', (e) => {
  e.stopPropagation();
  video.pause();
  if (video.src && video.src.startsWith('blob:')) { URL.revokeObjectURL(video.src); video.src = ''; }
  showPage('browser');
  closeAllPanels();
});

window.addEventListener('popstate', () => {
  if (pagePlayer.classList.contains('active')) { video.pause(); showPage('browser'); }
});

// ==================== 面板管理 ====================
function openPanel(panel) { closeAllPanels(false); panel.classList.add('open'); overlay.classList.add('active'); }
function closeAllPanels(hideOverlay = true) {
  speedPanel.classList.remove('open'); castPanel.classList.remove('open');
  playlistSidebar.classList.remove('open');
  if (hideOverlay) overlay.classList.remove('active');
}
overlay.addEventListener('click', () => closeAllPanels());

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', (e) => {
  if (!pagePlayer.classList.contains('active')) return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': skip(10); break;
    case 'ArrowLeft': skip(-10); break;
    case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.1); break;
    case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.1); break;
    case 'f': case 'F': btnFullscreen.click(); break;
    case 'Escape': video.pause(); showPage('browser'); break;
  }
});

// ==================== 横向滑动调进度 ====================
let touchStartX = 0, touchStartY = 0, touchStartVidTime = 0, isHSwipe = false;
videoWrap.addEventListener('touchstart', (e) => {
  if (e.target.closest('.player-controls, .player-topbar, .progress-bar-bg')) return;
  touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
  touchStartVidTime = video.currentTime; isHSwipe = false;
}, { passive: true });
videoWrap.addEventListener('touchmove', (e) => {
  if (e.target.closest('.player-controls, .player-topbar, .progress-bar-bg')) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (!isHSwipe && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) isHSwipe = true;
  if (isHSwipe && video.duration) {
    e.preventDefault();
    const seekDelta = (dx / window.innerWidth) * video.duration * 0.4;
    video.currentTime = Math.max(0, Math.min(video.duration, touchStartVidTime + seekDelta));
    const hint = dx > 0 ? hintRight : hintLeft;
    hint.textContent = (dx > 0 ? '+' : '-') + formatTime(Math.abs(Math.round(seekDelta)));
    hint.classList.add('show');
    updateProgress(); scheduleHideControls();
  }
}, { passive: false });
videoWrap.addEventListener('touchend', () => {
  isHSwipe = false;
  setTimeout(() => { hintLeft.classList.remove('show'); hintRight.classList.remove('show'); }, 600);
});

// ==================== NAS ====================
const btnNas = $('btn-nas');
btnNas.addEventListener('click', () => {
  const url = prompt('输入 NAS 视频目录的 HTTP 地址\n（需要先运行 VideoX NAS 服务端）', state.nasUrl || 'http://');
  if (!url) return;
  state.nasUrl = url;
  loadNasFiles(url);
});

async function loadNasFiles(baseUrl) {
  try {
    fileList.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>正在从 NAS 读取...</p></div>';
    emptyGuide.style.display = 'none';
    const resp = await fetch(baseUrl + '/list', { mode: 'cors' });
    if (!resp.ok) throw new Error('无法连接 NAS 服务');
    const data = await resp.json();
    if (!data.files || data.files.length === 0) {
      fileList.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>NAS 目录为空</p></div>';
      return;
    }
    renderNasFiles(data.files, baseUrl);
  } catch (e) {
    fileList.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><p>无法连接 NAS 服务</p><small>请确认 NAS 地址正确，或使用「打开视频」选择本地文件</small></div>`;
  }
}

function renderNasFiles(files, baseUrl) {
  fileList.innerHTML = '';
  renderSectionHeader(fileList, `NAS 文件（${files.length}）`, 'nas');
  files.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item video-item';
    item.innerHTML = `<div class="file-icon">🎬</div><div class="file-info"><div class="file-name">${f.name}</div><div class="file-meta">${formatSize(f.size)}</div></div><span class="file-arrow">▶</span>`;
    item.addEventListener('click', () => playNasVideo(f, baseUrl, files));
    fileList.appendChild(item);
  });
}

async function playNasVideo(file, baseUrl, allFiles) {
  if (needsNativePlayer(file.name)) {
    alert('⚠️ NAS 上的 ' + file.name.split('.').pop().toUpperCase() + ' 格式需通过本地文件播放');
    return;
  }
  showPage('player');
  videoTitle.textContent = file.name;
  document.title = file.name + ' — VideoX';
  video.src = baseUrl + '/file?path=' + encodeURIComponent(file.path);
  video.load(); video.play().catch(() => {});
  state.nasFiles = allFiles; state.nasBaseUrl = baseUrl;
  state.nasIndex = allFiles.findIndex(f => f.path === file.path);
  scheduleHideControls();
}

// ==================== 初始化 ====================
(function init() {
  state.viewMode = 'flat';
  btnViewFlat.classList.add('active');
  state.showHidden = true;
  btnToggleHidden.classList.add('active');
  updateStats();

  video.addEventListener('contextmenu', e => e.preventDefault());
  applyFitMode();
  history.pushState({ page: 'browser' }, '');

  // 初始状态：显示空引导
  emptyGuide.style.display = '';
  statsBar.style.display = 'none';
  selectBar.classList.remove('active');

  // 启动外部视频 bridge 轮询（addJavascriptInterface 100% 可靠）
  setTimeout(() => pollExternalVideoBridge(0), 200);

  console.log('[VideoX] 初始化完成 — 播放器优先 · 多选 · 目录树/平铺 · 外部 Intent');
})();
