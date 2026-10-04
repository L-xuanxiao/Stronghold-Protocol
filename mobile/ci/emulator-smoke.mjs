#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const adb = process.env.ADB || 'adb';
const serial = process.env.ANDROID_SERIAL;
const args = serial ? ['-s', serial] : [];
const run = (...more) => {
  const result = spawnSync(adb, [...args, ...more], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 << 20, windowsHide: true });
  if (result.status !== 0) throw new Error(`adb ${more[0]} failed: ${result.stderr || result.error}`);
  return result.stdout;
};
const apk = process.argv[2];
if (!apk) throw new Error('usage: node mobile/ci/emulator-smoke.mjs <apk>');
const packageName = 'io.github.strongholdprotocol.mobile';
const output = path.resolve('mobile/build/qa');
await fs.mkdir(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const uiNodes = xml => [...xml.matchAll(/<node\b([^>]*)>/g)].map(match =>
  Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], decode(attribute[2])])));
const textOf = nodes => nodes.map(node => `${node.text || ''} ${node['content-desc'] || ''}`).join('\n');
async function waitUi(name, matches) {
  let xml = '';
  for (let i = 0; i < 25; i++) {
    xml = run('exec-out', 'uiautomator', 'dump', '/dev/tty');
    const nodes = uiNodes(xml);
    const immersive = nodes.find(node => node.package === 'com.android.systemui' && node['resource-id'] === 'com.android.systemui:id/ok');
    if (immersive && nodes.some(node => node['resource-id'] === 'com.android.systemui:id/immersive_cling_title')) {
      await fs.writeFile(path.join(output, 'first-fullscreen-prompt.xml'), xml);
      tap(immersive);
      await sleep(1000);
      continue;
    }
    const errorDialog = nodes.find(node => node['resource-id'] === 'android:id/alertTitle' && /isn't responding|keeps stopping/.test(node.text));
    if (errorDialog) {
      await fs.writeFile(path.join(output, `${name}.xml`), xml);
      throw new Error(`Android reported an error dialog: ${errorDialog.text}`);
    }
    if (matches(nodes, textOf(nodes))) {
      await fs.writeFile(path.join(output, `${name}.xml`), xml);
      return nodes;
    }
    await sleep(1000);
  }
  await fs.writeFile(path.join(output, `${name}.xml`), xml);
  throw new Error(`visible game UI was not ready: ${name}`);
}
function tap(node) {
  // 坐标仅来自当前 UI 树；图片只用于最终人工复核。
  const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node?.bounds || '')?.slice(1).map(Number);
  if (!bounds || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('UI node has no visible bounds');
  run('shell', 'input', 'tap', String(Math.floor((bounds[0] + bounds[2]) / 2)), String(Math.floor((bounds[1] + bounds[3]) / 2)));
}
const healthNow = async () => {
  const response = await fetch('http://127.0.0.1:32173/healthz', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`health HTTP ${response.status}`);
  return response.json();
};
async function connectWebView() {
  const pid = run('shell', 'pidof', packageName).trim();
  if (!/^\d+$/.test(pid)) throw new Error('could not identify app process for WebView debugging');
  const port = Number(run('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).trim());
  debugPorts.push(port);
  let target;
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      target = pages.find(page => page.type === 'page' && page.url.startsWith('http://127.0.0.1:32173/'));
    } catch { /* WebView 调试 socket 可能晚于容器出现，按同一就绪期限重试。 */ }
    if (target) break;
    await sleep(1000);
  }
  if (!target) throw new Error('debug APK did not expose its local game WebView');
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(result.id);
    if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('WebView debugging connection closed')); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebView debugging connection timed out')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView debugging connection failed')); }, { once: true });
  });
  const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView DOM evaluation timed out')); }, 10000);
      pending.set(id, { timer, reject, resolve });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    close: () => socket.close(),
    insertText: text => command('Input.insertText', { text }),
    evaluate: async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    },
  };
}
async function waitDom(name, matches) {
  let state;
  for (let i = 0; i < 40; i++) {
    // Android 16 的 UIAutomator 可能仅暴露 WebView 容器，直接核对 debug WebView 的实际可见 DOM。
    state = await webView.evaluate('({visible:document.visibilityState==="visible",text:document.body.innerText,inputs:[...document.querySelectorAll("input")].map(i=>({value:i.value,type:i.type}))})');
    if (state.visible && matches(state)) {
      await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(state, null, 2));
      return state;
    }
    await sleep(1000);
  }
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(state, null, 2));
  throw new Error(`visible game DOM was not ready: ${name}`);
}
function nodePid() {
  const processes = run('shell', 'ps', '-A', '-o', 'PID,ARGS').split('\n');
  const children = processes.filter(line => line.includes('/libnode.so') && line.includes('mobile-main.mjs') && line.includes('--port=32173'));
  if (children.length !== 1) throw new Error(`expected one mobile Node process, found ${children.length}`);
  return Number(children[0].trim().split(/\s+/)[0]);
}
let original;
let forwarded = false;
const debugPorts = [];
let webView;
try {
  if (run('shell', 'getprop', 'ro.boot.qemu').trim() !== '1') throw new Error('fresh-data smoke must run on a disposable emulator');
  const pages = Number(run('shell', 'getconf', 'PAGE_SIZE').trim());
  const sdk = Number(run('shell', 'getprop', 'ro.build.version.sdk').trim());
  if (sdk !== 36 || pages !== 16384) throw new Error(`Android 16 / 16 KB required, got API ${sdk}, page size ${pages}`);
  if (run('shell', 'getprop', 'sys.boot_completed').trim() !== '1') throw new Error('emulator has not completed boot');
  original = Object.fromEntries(['airplane_mode_on', 'wifi_on', 'mobile_data']
    .map(key => [key, run('shell', 'settings', 'get', 'global', key).trim()]));
  run('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
  run('shell', 'svc', 'wifi', 'disable');
  run('shell', 'svc', 'data', 'disable');
  let connectivity;
  for (let i = 0; i < 20; i++) {
    connectivity = run('shell', 'dumpsys', 'connectivity');
    if (/Active default network:\s*none\b/i.test(connectivity)) break;
    await sleep(1000);
  }
  await fs.writeFile(path.join(output, 'offline-connectivity.txt'), connectivity);
  if (!/Active default network:\s*none\b/i.test(connectivity)) throw new Error('emulator still has an external default network');
  console.log(`Installing APK on Android ${sdk}, ${pages}-byte pages, external network disabled`);
  run('install', '-r', apk);
  // 独立测试设备上清理数据，避免上一轮解压缓存掩盖首次离线启动的问题。
  if (run('shell', 'pm', 'clear', packageName).trim() !== 'Success') throw new Error('could not clear smoke-test app data');
  const activity = run('shell', 'cmd', 'package', 'resolve-activity', '--brief', packageName).trim().split('\n').at(-1);
  if (!activity.includes('/')) throw new Error('launcher activity not resolved');
  run('shell', 'am', 'start', '-n', activity);
  console.log('Fresh app data cleared; waiting for bundled server');
  run('forward', 'tcp:32173', 'tcp:32173');
  forwarded = true;
  let health;
  for (let i = 0; i < 120; i++) {
    try {
      health = await healthNow();
      if (health.ok) break;
    } catch { /* 首次安装解压需要时间，失败日志最后统一保存。 */ }
    await sleep(2000);
  }
  if (!health?.ok) throw new Error('local game server did not become ready');
  console.log(`Bundled game server ready: ${health.app}`);
  const lock = JSON.parse(await fs.readFile('mobile/game.lock.json', 'utf8'));
  if (health.app !== lock.version) throw new Error(`wrong game version: ${health.app}`);
  for (const url of ['/', '/vendor/pixi.min.js', '/data/chess.json', '/sim/simdata.js']) {
    const response = await fetch(`http://127.0.0.1:32173${url}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`missing offline resource ${url}: ${response.status}`);
  }
  await waitUi('native', nodes => nodes.some(node => node.class === 'android.webkit.WebView'));
  webView = await connectWebView();
  await waitDom('title', state => state.text.includes('STRONGHOLD PROTOCOL') && state.text.includes('博士代号') && state.text.includes('已连接服务器')
    && state.inputs.some(input => input.type === 'text'));
  await webView.evaluate('[...document.querySelectorAll("input")].find(input=>input.type==="text").focus()');
  await webView.insertText('AndroidQA');
  await waitDom('nickname-input', state => state.inputs.some(input => input.type === 'text' && input.value === 'AndroidQA'));
  await webView.evaluate('[...document.querySelectorAll("button")].find(button=>button.innerText.trim()==="开始"&&!button.disabled).click()');
  await waitDom('lobby', state => state.text.includes('选择模拟协议') && state.text.includes('独立模拟') && state.text.includes('AndroidQA'));
  console.log('Visible game title and nickname-to-lobby interaction passed');
  health = await healthNow();
  if (!Number.isInteger(health.sockets) || health.sockets < 1) throw new Error('visible WebView did not connect to the local game WebSocket');
  if (!Number.isInteger(health.uptimeSec)) throw new Error('game server did not report its uptime');
  const before = { app: run('shell', 'pidof', packageName).trim(), node: nodePid(), uptimeSec: health.uptimeSec };
  webView.close(); webView = null;
  // Android 12+ 普通返回可能只后台化任务；am -R 会结束上一个 Activity 并重复启动，Service 保持运行。
  const destroyEvents = () => run('logcat', '-b', 'events', '-d', '-v', 'brief')
    .split('\n').filter(line => line.includes('wm_on_destroy_called') && line.includes(`${packageName}.MainActivity`)).length;
  const destroyedBefore = destroyEvents();
  run('shell', 'am', 'start', '-W', '-R', '2', '-n', activity);
  let destroyed = false;
  for (let i = 0; i < 20; i++) {
    if (destroyEvents() > destroyedBefore) { destroyed = true; break; }
    await sleep(1000);
  }
  if (!destroyed) throw new Error('Activity destruction was not observed; recreation was not tested');
  console.log('Activity destruction observed; checking service continuity and saved nickname');
  await waitUi('recreated-native', nodes => nodes.some(node => node.class === 'android.webkit.WebView'));
  webView = await connectWebView();
  await waitDom('recreated', state => (state.text.includes('AndroidQA') || state.inputs.some(input => input.value === 'AndroidQA'))
    && (state.text.includes('选择模拟协议') || state.text.includes('STRONGHOLD PROTOCOL') && state.text.includes('已连接服务器')));
  const again = await healthNow();
  const after = { app: run('shell', 'pidof', packageName).trim(), node: nodePid(), uptimeSec: again.uptimeSec };
  if (!again.ok || before.app !== after.app || before.node !== after.node || after.uptimeSec < before.uptimeSec) {
    throw new Error('Activity recreation restarted or lost the local server');
  }
  await fs.writeFile(path.join(output, 'smoke.json'), JSON.stringify({ health: again, apiLevel: sdk, pageSize: pages, activity, before, after,
    verified: ['fresh offline launch without external network', 'bundled resources', 'visible game UI', 'nickname and lobby interaction',
      'WebView WebSocket connection', 'Activity destruction and recreation', 'same Node process', 'nickname retention'] }, null, 2));
  console.log(`Android smoke passed, page size=${pages}`);
} finally {
  webView?.close();
  const logs = spawnSync(adb, [...args, 'logcat', '-d'], { encoding: 'utf8', maxBuffer: 32 << 20, timeout: 60000, windowsHide: true });
  await fs.writeFile(path.join(output, 'logcat.txt'), logs.stdout || logs.stderr || '');
  const screen = spawnSync(adb, [...args, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 << 20, timeout: 60000, windowsHide: true });
  if (screen.status === 0) await fs.writeFile(path.join(output, 'screen.png'), screen.stdout);
  const tree = spawnSync(adb, [...args, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  await fs.writeFile(path.join(output, 'ui.xml'), tree.stdout || '');
  if (forwarded) spawnSync(adb, [...args, 'forward', '--remove', 'tcp:32173'], { timeout: 10000, windowsHide: true });
  for (const port of debugPorts) spawnSync(adb, [...args, 'forward', '--remove', `tcp:${port}`], { timeout: 10000, windowsHide: true });
  if (original) {
    for (const command of [
      ['shell', 'cmd', 'connectivity', 'airplane-mode', original.airplane_mode_on === '1' ? 'enable' : 'disable'],
      ['shell', 'svc', 'wifi', original.wifi_on === '1' ? 'enable' : 'disable'],
      ['shell', 'svc', 'data', original.mobile_data === '1' ? 'enable' : 'disable'],
    ]) {
      const restored = spawnSync(adb, [...args, ...command], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (restored.status !== 0) { console.error(`Could not restore emulator setting: ${command.join(' ')}: ${restored.stderr || restored.error}`); process.exitCode = 1; }
    }
  }
}
