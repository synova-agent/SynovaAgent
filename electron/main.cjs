/**
 * electron/main.js — Electron 瘦客户端主进程 (D111 + D233)
 *
 * D233 新增:
 *   - Tray try/catch 降级（icon.png 缺失不崩溃）
 *   - Server 可达性检测（checkServer -> GET /api/healthz）
 *   - Server 不可达时显示内置离线错误页
 *   - BrowserWindow icon try/catch
 *   - app.isQuitting 标记
 *
 * D111 原有:
 *   - 系统托盘驻留 + P0 告警轮询
 *   - 桌面通知推送
 *   - 不运行诊断逻辑
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { ensureBackend } = require('./backend-spawn.cjs');

let mainWindow, tray;
let backendHandle = null; // D504: ensureBackend 返回句柄（stop 回收用）
let isQuitting = false;
const config = require('./config.json');
const SERVER_URL = config.serverUrl || 'http://localhost:18790';
const POLL_INTERVAL = config.pollInterval || 300000; // 5 min

/**
 * 检测 Server 是否可达。
 * GET /api/healthz，5 秒超时。
 */
function checkServer(url, healthPath = '/api/healthz') {
  return new Promise((resolve) => {
    const req = http.get(`${url}${healthPath}`, { timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * 生成离线错误页 HTML。
 */
function getOfflineHTML(serverUrl) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>Synova — Server Offline</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:#0f172a; color:#e2e8f0; display:flex;
  align-items:center; justify-content:center; height:100vh; }
.card { background:#1e293b; border-radius:12px; padding:40px; text-align:center; max-width:480px; }
h1 { font-size:24px; margin-bottom:12px; color:#f59e0b; }
p { font-size:14px; color:#94a3b8; margin-bottom:20px; line-height:1.6; }
code { background:#0f172a; padding:2px 8px; border-radius:4px; font-size:13px; color:#22c55e; }
.btn { display:inline-block; margin-top:8px; padding:10px 24px;
  background:#22c55e; color:#0f172a; border-radius:6px;
  text-decoration:none; font-size:14px; font-weight:600; }
</style>
</head><body>
<div class="card">
  <h1>&#9888; Synova Server 未启动</h1>
  <p>Electron 客户端无法连接到 Synova 服务器。<br>
  请确保服务器已在终端中启动：</p>
  <p><code>npm run dev</code></p>
  <p style="font-size:12px;color:#64748b">服务器地址: ${serverUrl}</p>
  <a class="btn" href="#" onclick="location.reload()">重试连接</a>
</div></body></html>`;
}

async function createWindow() {
  // F3 修复（2026-09-13，Win 侧重验发现 + Mac 侧交叉确认）：
  //   打包态 Electron 默认 sandbox:true，沙箱化 preload **不允许 require 相对文件** →
  //   preload.cjs 的 require('./config.json') 抛 "module not found" → contextBridge 从未执行 →
  //   window.electronAPI === undefined → 渲染层 getApiBase() 退化为 '' → API 请求打到 file://
  //   被 CSP 拦截 → **窗口能开但 UI 用不了**（Mac/Win 同源，非平台差异）。
  //   修法＝不关 renderer 沙箱（保持安全姿态），改用 Electron 官方推荐的
  //   webPreferences.additionalArguments 把配置透传给沙箱 preload（process.argv 在沙箱内可用）。
  const electronConfig = require('./config.json');
  const serverUrl = electronConfig.serverUrl || 'http://localhost:18790';
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    // T2b(#1481): 最小值 = 展开态三栏 240+400+320 ＋ 余量 40 / 顶 48+内容 400+状态栏 28 ＋ 余量 24
    minWidth: 1000, minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--synova-server-url=${serverUrl}`],
    },
  });

  // icon 可选 — 文件缺失时跳过
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (require('fs').existsSync(iconPath)) {
      mainWindow.setIcon(iconPath);
    }
  } catch (e) {
    console.warn('[electron] icon 设置失败 — 跳过 (degraded)');
  }

  // D504 双引导收敛（L1-5 单一入口）:
  //   prod（双击安装包, app.isPackaged）→ 加载打包内 renderer 产物（React 对话 UI + consult 首诊链路）
  //   dev → 优先 vite dev server（renderer 热更新），不可达则回退服务器登录页
  const isProd = app.isPackaged;
  const backendDegraded = backendHandle && backendHandle.degraded;

  // F3 启动自检（2026-09-13）：让应用自己报告 preload 契约是否成立——
  //   窗口/进程/healthz 三项全绿也可能掩盖「渲染层连不上后端」（D523 四断言曾全绿而 UI 全废）。
  //   这一行输出是回归哨兵：出现 FAIL 即代表 electronAPI 未暴露、UI 将全线失效。
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const probe = await mainWindow.webContents.executeJavaScript(
        '({ hasApi: typeof window.electronAPI !== "undefined",'
        + ' serverUrl: (window.electronAPI && window.electronAPI.getServerUrl) ? window.electronAPI.getServerUrl() : null })',
      );
      if (probe && probe.hasApi) {
        console.log(`[preload-check] OK: electronAPI 已暴露, serverUrl=${probe.serverUrl}`);
      } else {
        console.error('[preload-check] FAIL: window.electronAPI 未暴露 — 渲染层无法访问后端（F3 回归？）');
      }
    } catch (err) {
      console.error(`[preload-check] 探针执行失败: ${err && err.message ? err.message : String(err)}`);
    }
  });

  if (isProd) {
    mainWindow.loadFile(path.join(process.resourcesPath, 'renderer', 'index.html'));
  } else if (await checkServer('http://localhost:5173', '/')) {
    // dev: renderer vite dev server 在跑（npm run dev 于 electron-renderer/）→ 热更新 UI
    mainWindow.loadURL('http://localhost:5173');
  } else if (backendDegraded || !(await checkServer(SERVER_URL))) {
    // 服务自启降级或仍不可达 → 离线页 + degraded 提示（铁律 11/24：不静默）
    if (backendDegraded) {
      console.error('[electron] 后端自启降级 —', backendHandle.error || '未知原因');
    }
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getOfflineHTML(SERVER_URL))}`);
  } else {
    mainWindow.loadURL(`${SERVER_URL}/app/login.html`);
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ═══ D528: 单实例锁（多实例写同一 SQLite 保护，Electron 官方模式）═══
// 契约: 二次启动 → 本实例 app.quit() 退出；首实例收到 second-instance → 聚焦已有窗口。
// @degraded: requestSingleInstanceLock 抛异常（罕见）→ try/catch + log，不阻断首实例正常启动（铁律 24）。
let gotSingleInstanceLock = true;
try {
  gotSingleInstanceLock = app.requestSingleInstanceLock();
} catch (err) {
  console.warn('[electron] requestSingleInstanceLock 异常（继续单实例路径）:', err && err.message);
}
if (!gotSingleInstanceLock) {
  console.log('[electron] 已有实例运行，本实例退出（单实例锁）');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ═══ D602: IPC 通道（preload.cjs 8 方法契约的 main 侧，spec §5.2-A）═══
// 安全边界（Anthropic 基线）: renderer 半可信——每个 handler 对入参做类型/枚举/长度校验，
// 非法 → console.warn 留痕 + 忽略（不抛回 renderer、不静默，铁律 24）；
// tray 未初始化（icon 降级路径）→ warn + 忽略（不抛）。
// 通道名与 electron/preload.cjs CHANNELS 一一对应（ipc-contract.test.ts 用例 3 物理锁定）。

const TRAY_STATES = ['normal', 'unread', 'critical'];
const NOTIFY_TEXT_MAX = 200;

/** 文本安全化: 任意入参字符串化 + 截断（通知 title/body 上限 200） */
function clampText(v, max) {
  const s = typeof v === 'string' ? v : String(v ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// invoke 'app:get-version' → 应用版本（renderer bridge.getAppVersion 消费）
ipcMain.handle('app:get-version', () => {
  try {
    return app.getVersion();
  } catch (err) {
    console.warn('[electron] app:get-version 失败 — 降级空串:', err && err.message);
    return '';
  }
});

// send 'tray:update-state' — 托盘角标（alertCount = open 工单数，App.tsx effect 消费）
ipcMain.on('tray:update-state', (_event, state, count) => {
  try {
    if (typeof state !== 'string' || !TRAY_STATES.includes(state)) {
      console.warn('[electron] tray:update-state 非法 state — 忽略:', state);
      return;
    }
    if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
      console.warn('[electron] tray:update-state 非法 count（须正整数）— 忽略:', count);
      return;
    }
    if (!tray) {
      console.warn('[electron] tray:update-state — tray 未初始化（degraded），忽略');
      return;
    }
    if (process.platform === 'darwin' && state !== 'normal' && typeof count === 'number') {
      tray.setTitle(`(${count})`); // macOS 菜单栏角标数字
    }
    tray.setToolTip(state === 'normal' ? 'SynovaAgent' : `SynovaAgent — ${count} 条未处理告警`);
  } catch (err) {
    console.warn('[electron] tray:update-state 失败 — 忽略（degraded）:', err && err.message);
  }
});

// send 'notify:show' — 系统通知；被点击 → 聚焦窗口 + 'notification:click' 回传 renderer 面板
ipcMain.on('notify:show', (_event, title, body, id) => {
  try {
    const notification = new Notification({
      title: clampText(title, NOTIFY_TEXT_MAX) || 'Synova',
      body: clampText(body, NOTIFY_TEXT_MAX),
    });
    notification.on('click', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('notification:click', id);
        }
      } catch (err) {
        console.warn('[electron] 通知点击处理失败 —', err && err.message);
      }
    });
    notification.show();
  } catch (err) {
    console.warn('[electron] notify:show 失败 — 忽略（degraded）:', err && err.message);
  }
});

app.whenReady().then(async () => {
  // D518: 模式显式化——启动第一行日志即证据（dev/prod 判定唯一事实源 app.isPackaged）
  const isProdBoot = app.isPackaged;
  console.log('[electron] boot mode=' + (isProdBoot ? 'prod' : 'dev') + ' server=' + SERVER_URL);
  // D504 服务自启（L1-4 开窗即用——用户不碰命令行）:
  //   dev: npx tsx src/index.ts; prod: node dist/src/index.js + SYNOVA_DB_PATH=userData（L1-7 升级不丢数据; F4 注释同步——磁盘事实 dist/src/index.js）
  try {
    backendHandle = await ensureBackend({
      serverUrl: SERVER_URL,
      cwd: isProdBoot ? process.resourcesPath : process.cwd(),
      mode: isProdBoot ? 'prod' : 'dev',
      dbPath: isProdBoot ? path.join(app.getPath('userData'), 'data', 'synova.db') : undefined,
      logFile: isProdBoot ? path.join(app.getPath('userData'), 'logs', 'backend.log') : undefined,
    });
    if (backendHandle.degraded) {
      console.error('[electron] 后端自启 degraded —', backendHandle.error || '未知原因');
    }
  } catch (err) {
    // ensureBackend 契约不抛——此处为防御性兜底（铁律 24：log.error 不静默）
    console.error('[electron] ensureBackend 异常（防御性兜底）—', err && err.message);
    backendHandle = { started: false, degraded: true, error: String(err && err.message) };
  }

  await createWindow();

  // ── 系统托盘 (try/catch 降级) ──
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (!require('fs').existsSync(iconPath)) {
      console.warn('[electron] icon.png 不存在 — 跳过 Tray (degraded)');
    } else {
      tray = new Tray(iconPath);
      tray.setToolTip('SynovaAgent');
      // D602: 菜单三项全指向现役 UI（审计 §3.5.2 :176-177 旧页菜单缺陷修复——旧页 URL 引用物理清零，
      // ipc-contract.test.ts 用例 4 锁定）；导航语义经 'navigate' 通道交 renderer 处理，main 不再 loadURL 页面
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开 Synova', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate', 'chat'); } } },
        { label: '打开通知中心', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.webContents.send('navigate', 'notifications'); } } },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
      ]));
      tray.on('double-click', () => mainWindow.show());
    }
  } catch (e) {
    console.warn('[electron] Tray 初始化失败 — 跳过 (degraded)', e.message);
  }

  // ── P0 告警轮询 ──
  setInterval(checkP0Alerts, POLL_INTERVAL);
  setTimeout(checkP0Alerts, 5000);
});

async function checkP0Alerts() {
  try {
    const res = await fetch(`${SERVER_URL}/api/cockpit/data`);
    const data = await res.json();
    const signals = data.signals || {};
    const redCount = Object.values(signals).filter(s => s.status === 'red').length;
    if (redCount > 0) {
      const title = 'Synova P0 Alert';
      const body = `${redCount} critical ${redCount > 1 ? 'issues' : 'issue'} detected — check dashboard.`;
      new Notification({ title, body }).show();
      // D602: OS 通知旁路推 renderer 通知面板（'push-notification' 通道，App.tsx 订阅 → 本地通知段；
      // spec §5.2-B P0 轮询路径——只到 OS 层 renderer 无感知的缺陷修复）
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('push-notification', { title, body, id: `p0-${Date.now()}` });
      }
    }
  } catch (err) {
    console.warn('[electron] P0 check failed:', err.message);
  }
}

app.on('before-quit', () => {
  isQuitting = true;
  // D504: 退出回收后端子进程（生命周期闭环，无孤儿）
  try { backendHandle && backendHandle.stop && backendHandle.stop(); } catch (e) {
    console.warn('[electron] backend stop 失败 —', e.message);
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
