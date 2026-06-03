'use strict';

/*
 * CrashBandit-ADB-Tool :: backend
 * -------------------------------
 * Express REST API + WebSocket server that drives a local `adb` binary against
 * Android devices reachable over Wi-Fi (ADB over TCP/IP).
 *
 * WARNING: This tool exposes raw `adb shell` access to its operator. Run it ONLY
 * on a trusted network / behind your own auth. Never expose port 3000 to the
 * public internet without a reverse-proxy + authentication in front of it.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADB = process.env.ADB_BIN || 'adb';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'adb-net-uploads');
const SERVER_ROOT = process.env.SERVER_ROOT || '/data'; // server-side file browser root

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
try { fs.mkdirSync(SERVER_ROOT, { recursive: true }); } catch (_) { /* ignore */ }

// --- in-memory state -------------------------------------------------------
const state = {
  selectedSerial: null, // currently targeted device serial (e.g. 192.168.1.42:5555)
};

// ---------------------------------------------------------------------------
//  ADB helpers
// ---------------------------------------------------------------------------

// Build the argument array, optionally prefixing the target device with -s.
function withTarget(args, useTarget = true) {
  if (useTarget && state.selectedSerial) {
    return ['-s', state.selectedSerial, ...args];
  }
  return args;
}

// Run adb and buffer the (text) output. Rejects on non-zero exit.
function adb(args, { useTarget = true, timeout = 30000, maxBuffer = 1024 * 1024 * 64 } = {}) {
  return new Promise((resolve, reject) => {
    const finalArgs = withTarget(args, useTarget);
    execFile(ADB, finalArgs, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// Spawn adb and return the raw process (for streaming binary / long-running).
function adbSpawn(args, { useTarget = true } = {}) {
  return spawn(ADB, withTarget(args, useTarget));
}

// Collect a spawned process' stdout into a single Buffer.
function adbBuffer(args, { useTarget = true, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = adbSpawn(args, { useTarget });
    const out = [];
    const errOut = [];
    let done = false;
    const t = setTimeout(() => {
      if (!done) { child.kill('SIGKILL'); reject(new Error('adb timeout')); }
    }, timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => errOut.push(d));
    child.on('error', (e) => { done = true; clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      done = true;
      clearTimeout(t);
      if (code !== 0 && out.length === 0) {
        return reject(new Error(Buffer.concat(errOut).toString() || `adb exited ${code}`));
      }
      resolve(Buffer.concat(out));
    });
  });
}

// Parse `adb devices -l` output into structured device list.
function parseDevices(stdout) {
  const lines = stdout.split('\n').slice(1); // drop the "List of devices attached" header
  const devices = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const status = parts[1] || 'unknown';
    const info = {};
    for (const seg of parts.slice(2)) {
      const [k, v] = seg.split(':');
      if (k && v) info[k] = v;
    }
    devices.push({ serial, status, model: info.model || null, product: info.product || null });
  }
  return devices;
}

// Derive a human-friendly display name from a package id.
function friendlyName(pkg) {
  const segs = pkg.split('.');
  let last = segs[segs.length - 1] || pkg;
  if (last.length <= 2 && segs.length >= 2) last = segs[segs.length - 2];
  return last
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
//  Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 1024 * 1024 * 1024 } });

// small async wrapper
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  res.status(500).json({ ok: false, error: (e && (e.stderr || e.message)) || String(e) });
});

// --- Connection ------------------------------------------------------------

app.get('/api/devices', wrap(async (req, res) => {
  const { stdout } = await adb(['devices', '-l'], { useTarget: false });
  const devices = parseDevices(stdout);
  // keep selection valid
  if (state.selectedSerial && !devices.find((d) => d.serial === state.selectedSerial)) {
    state.selectedSerial = null;
  }
  if (!state.selectedSerial) {
    const online = devices.find((d) => d.status === 'device');
    if (online) state.selectedSerial = online.serial;
  }
  res.json({ ok: true, devices, selected: state.selectedSerial });
}));

app.post('/api/select', wrap(async (req, res) => {
  const { serial } = req.body || {};
  state.selectedSerial = serial || null;
  res.json({ ok: true, selected: state.selectedSerial });
}));

app.post('/api/connect', wrap(async (req, res) => {
  const { ip, port } = req.body || {};
  if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
  const target = `${ip}:${port || 5555}`;
  const { stdout, stderr } = await adb(['connect', target], { useTarget: false });
  const text = (stdout + stderr).trim();
  const success = /connected to/i.test(text) && !/cannot|failed|unable/i.test(text);
  if (success) state.selectedSerial = target;
  res.json({ ok: success, message: text, selected: state.selectedSerial });
}));

app.post('/api/pair', wrap(async (req, res) => {
  const { ip, port, code } = req.body || {};
  if (!ip || !port || !code) return res.status(400).json({ ok: false, error: 'ip, port and code required' });
  const { stdout, stderr } = await adb(['pair', `${ip}:${port}`, String(code)], { useTarget: false, timeout: 20000 });
  const text = (stdout + stderr).trim();
  const success = /successfully paired/i.test(text);
  res.json({ ok: success, message: text });
}));

app.post('/api/disconnect', wrap(async (req, res) => {
  const { serial } = req.body || {};
  const args = serial ? ['disconnect', serial] : ['disconnect'];
  const { stdout, stderr } = await adb(args, { useTarget: false });
  if (!serial || serial === state.selectedSerial) state.selectedSerial = null;
  res.json({ ok: true, message: (stdout + stderr).trim() });
}));

// --- Device info -----------------------------------------------------------

app.get('/api/deviceinfo', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.json({ ok: false, error: 'no device selected' });
  const getprop = async (p) => {
    try { return (await adb(['shell', 'getprop', p])).stdout.trim(); } catch { return ''; }
  };
  const [model, brand, release, sdk, size] = await Promise.all([
    getprop('ro.product.model'),
    getprop('ro.product.brand'),
    getprop('ro.build.version.release'),
    getprop('ro.build.version.sdk'),
    adb(['shell', 'wm', 'size']).then((r) => r.stdout.trim()).catch(() => ''),
  ]);
  res.json({ ok: true, serial: state.selectedSerial, model, brand, android: release, sdk, screen: size });
}));

// --- App manager -----------------------------------------------------------

app.get('/api/apps', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.json({ ok: false, error: 'no device selected' });
  const type = req.query.type === 'system' ? 'system' : 'user';
  // -3 user-installed, -s system. Include -f for path, and list enabled/disabled state.
  const flag = type === 'system' ? '-s' : '-3';
  const { stdout } = await adb(['shell', 'pm', 'list', 'packages', flag]);
  const pkgs = stdout.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.slice('package:'.length).trim())
    .filter(Boolean)
    .sort();

  // disabled packages (state 2/3/4). One call, used to flag rows.
  let disabled = new Set();
  try {
    const dis = await adb(['shell', 'pm', 'list', 'packages', '-d']);
    disabled = new Set(dis.stdout.split('\n')
      .map((l) => l.trim().replace(/^package:/, ''))
      .filter(Boolean));
  } catch (_) { /* ignore */ }

  const apps = pkgs.map((p) => ({
    package: p,
    name: friendlyName(p),
    type,
    disabled: disabled.has(p),
  }));
  res.json({ ok: true, type, count: apps.length, apps });
}));

app.post('/api/uninstall', wrap(async (req, res) => {
  const { packages = [], keepData = false } = req.body || {};
  const results = [];
  for (const p of packages) {
    try {
      // --user 0 uninstalls for current user even for system apps (no root needed)
      const args = ['shell', 'pm', 'uninstall'];
      if (keepData) args.push('-k');
      args.push('--user', '0', p);
      const { stdout } = await adb(args);
      results.push({ package: p, ok: /Success/i.test(stdout), out: stdout.trim() });
    } catch (e) {
      results.push({ package: p, ok: false, out: (e.stderr || e.message || '').trim() });
    }
  }
  res.json({ ok: true, results });
}));

app.post('/api/disable', wrap(async (req, res) => {
  const { packages = [] } = req.body || {};
  const results = [];
  for (const p of packages) {
    try {
      const { stdout } = await adb(['shell', 'pm', 'disable-user', '--user', '0', p]);
      results.push({ package: p, ok: /new state|disabled/i.test(stdout), out: stdout.trim() });
    } catch (e) {
      results.push({ package: p, ok: false, out: (e.stderr || e.message || '').trim() });
    }
  }
  res.json({ ok: true, results });
}));

app.post('/api/enable', wrap(async (req, res) => {
  const { packages = [] } = req.body || {};
  const results = [];
  for (const p of packages) {
    try {
      // re-install for user 0 in case it was uninstalled --user, then enable
      let out = '';
      try { out += (await adb(['shell', 'cmd', 'package', 'install-existing', p])).stdout; } catch (_) {}
      try { out += '\n' + (await adb(['shell', 'pm', 'enable', p])).stdout; } catch (_) {}
      results.push({ package: p, ok: true, out: out.trim() });
    } catch (e) {
      results.push({ package: p, ok: false, out: (e.stderr || e.message || '').trim() });
    }
  }
  res.json({ ok: true, results });
}));

// --- APK backup / extractor -------------------------------------------------

app.get('/api/apk/:pkg', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.status(400).json({ ok: false, error: 'no device selected' });
  const pkg = req.params.pkg;
  if (!/^[A-Za-z0-9_.]+$/.test(pkg)) return res.status(400).json({ ok: false, error: 'invalid package' });
  const { stdout } = await adb(['shell', 'pm', 'path', pkg]);
  const paths = stdout.split('\n')
    .map((l) => l.trim().replace(/^package:/, ''))
    .filter(Boolean);
  if (!paths.length) return res.status(404).json({ ok: false, error: 'apk path not found' });
  const base = paths.find((p) => /base\.apk$/.test(p)) || paths[0];

  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${pkg}.apk"`);
  if (paths.length > 1) res.setHeader('X-APK-Splits', String(paths.length));

  // Stream the apk straight off the device — no temp file.
  const child = adbSpawn(['exec-out', 'cat', base]);
  child.stdout.pipe(res);
  child.stderr.on('data', () => {});
  child.on('error', () => { if (!res.headersSent) res.status(500).end('pull error'); });
  req.on('close', () => child.kill('SIGKILL'));
}));

// --- File manager ----------------------------------------------------------

function safeServerPath(p) {
  const resolved = path.resolve(SERVER_ROOT, '.' + path.posix.normalize('/' + (p || '/')));
  if (!resolved.startsWith(path.resolve(SERVER_ROOT))) return SERVER_ROOT;
  return resolved;
}

app.get('/api/fs/server', wrap(async (req, res) => {
  const rel = req.query.path || '/';
  const abs = safeServerPath(rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true }).map((d) => {
    let size = 0;
    try { size = d.isFile() ? fs.statSync(path.join(abs, d.name)).size : 0; } catch (_) {}
    return { name: d.name, dir: d.isDirectory(), size };
  }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  res.json({ ok: true, root: SERVER_ROOT, path: rel, entries });
}));

app.get('/api/fs/device', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.json({ ok: false, error: 'no device selected' });
  const dir = req.query.path || '/sdcard/';
  // -p marks dirs with trailing slash, -1 one per line, -A include dotfiles
  const { stdout } = await adb(['shell', 'ls', '-1Ap', dir.replace(/"/g, '')]);
  const entries = stdout.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((n) => ({ name: n.replace(/\/$/, ''), dir: n.endsWith('/'), size: 0 }))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  res.json({ ok: true, path: dir, entries });
}));

// Upload to server, then push to device.
app.post('/api/fs/push', upload.single('file'), wrap(async (req, res) => {
  if (!state.selectedSerial) return res.status(400).json({ ok: false, error: 'no device selected' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const remoteDir = (req.body.remote || '/sdcard/').replace(/"/g, '');
  const remotePath = remoteDir.replace(/\/+$/, '') + '/' + req.file.originalname;
  try {
    const { stdout, stderr } = await adb(['push', req.file.path, remotePath], { timeout: 600000 });
    res.json({ ok: true, message: (stdout + stderr).trim(), remote: remotePath });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

// Pull a file off the device and stream it to the browser.
app.get('/api/fs/pull', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.status(400).json({ ok: false, error: 'no device selected' });
  const remote = req.query.path;
  if (!remote) return res.status(400).json({ ok: false, error: 'path required' });
  const name = remote.split('/').filter(Boolean).pop() || 'file';
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const child = adbSpawn(['exec-out', 'cat', remote]);
  child.stdout.pipe(res);
  child.stderr.on('data', () => {});
  child.on('error', () => { if (!res.headersSent) res.status(500).end('pull error'); });
  req.on('close', () => child.kill('SIGKILL'));
}));

// Upload a file directly from the browser into the server file store.
app.post('/api/fs/server-upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const dest = safeServerPath((req.body.path || '/') + '/' + req.file.originalname);
  fs.renameSync(req.file.path, dest);
  res.json({ ok: true, path: dest });
}));

// --- Default apps ----------------------------------------------------------

app.get('/api/launchers', wrap(async (req, res) => {
  if (!state.selectedSerial) return res.json({ ok: false, error: 'no device selected' });
  // Query packages that handle the HOME intent.
  const { stdout } = await adb(['shell', 'cmd', 'package', 'query-activities', '--brief',
    '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
  const launchers = stdout.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('/'))
    .map((l) => {
      const comp = l.split(/\s+/).pop();
      return { component: comp, package: comp.split('/')[0] };
    });
  res.json({ ok: true, launchers });
}));

app.post('/api/set-home', wrap(async (req, res) => {
  const { component } = req.body || {};
  if (!component) return res.status(400).json({ ok: false, error: 'component required' });
  const { stdout, stderr } = await adb(['shell', 'cmd', 'package', 'set-home-activity', component]);
  res.json({ ok: /Success/i.test(stdout + stderr), message: (stdout + stderr).trim() });
}));

// Open the Android default-apps settings screen as a convenience.
app.post('/api/open-default-apps', wrap(async (req, res) => {
  const { stdout, stderr } = await adb(['shell', 'am', 'start', '-a',
    'android.settings.MANAGE_DEFAULT_APPS_SETTINGS']);
  res.json({ ok: true, message: (stdout + stderr).trim() });
}));

// ---------------------------------------------------------------------------
//  HTTP server + WebSocket upgrades
// ---------------------------------------------------------------------------
const server = http.createServer(app);

// Two WS endpoints, routed by path.
const consoleWss = new WebSocketServer({ noServer: true });
const screenWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws/console') {
    consoleWss.handleUpgrade(req, socket, head, (ws) => consoleWss.emit('connection', ws, req));
  } else if (pathname === '/ws/screen') {
    screenWss.handleUpgrade(req, socket, head, (ws) => screenWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// --- Interactive shell WS ---------------------------------------------------
consoleWss.on('connection', (ws) => {
  if (!state.selectedSerial) {
    ws.send(JSON.stringify({ type: 'err', data: 'No device selected. Connect first.\n' }));
    ws.close();
    return;
  }
  // Persistent interactive adb shell — a real PTY-ish session.
  const shell = adbSpawn(['shell']);
  ws.send(JSON.stringify({ type: 'sys', data: `# interactive shell on ${state.selectedSerial}\n` }));

  shell.stdout.on('data', (d) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'out', data: d.toString() })));
  shell.stderr.on('data', (d) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'out', data: d.toString() })));
  shell.on('close', () => { if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ type: 'sys', data: '\n# shell closed\n' })); ws.close(); } });
  shell.on('error', (e) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'err', data: String(e) + '\n' })));

  ws.on('message', (msg) => {
    let parsed;
    try { parsed = JSON.parse(msg.toString()); } catch { parsed = { cmd: msg.toString() }; }
    if (typeof parsed.cmd === 'string') {
      shell.stdin.write(parsed.cmd.replace(/\r?\n?$/, '') + '\n');
    }
  });
  ws.on('close', () => { try { shell.kill('SIGKILL'); } catch (_) {} });
});

// --- Screencast WS ----------------------------------------------------------
screenWss.on('connection', (ws) => {
  if (!state.selectedSerial) {
    ws.send(JSON.stringify({ type: 'err', data: 'No device selected.' }));
    ws.close();
    return;
  }
  let running = true;
  const serial = state.selectedSerial;

  // Animation scales we touch, so we can restore them on disconnect.
  const ANIM_KEYS = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];

  // One-time: kill on-device animations to cut rendering overhead per frame.
  // Restored to 1 on ws close so we don't leave the phone permanently animation-less.
  for (const k of ANIM_KEYS) {
    spawn(ADB, ['-s', serial, 'shell', 'settings', 'put', 'global', k, '0']);
  }

  // Send device resolution so the client can map taps.
  adb(['shell', 'wm', 'size']).then(({ stdout }) => {
    const m = stdout.match(/(\d+)x(\d+)/);
    if (m && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'meta', width: parseInt(m[1], 10), height: parseInt(m[2], 10) }));
    }
  }).catch(() => {});

  // Grab one frame as PNG via exec-out (binary-safe, no CRLF mangling).
  // No fixed delay: the device's own screencap latency (~200-400ms) paces the
  // loop. We fire the next grab the instant the previous frame finishes.
  const FRAME_PATH = '/sdcard/.cb_frame.png';
  function grabFrame() {
    if (!running || ws.readyState !== ws.OPEN) return;
    // Step 1: capture to device storage. exec-out screencap -p hangs on some
    // devices (Xiaomi/HyperOS), so we write to a file via a plain shell first.
    const cap = spawn(ADB, ['-s', serial, 'shell', 'screencap', '-p', FRAME_PATH]);
    cap.stderr.on('data', () => {});
    cap.on('error', () => { if (running) setTimeout(grabFrame, 200); }); // back off on hard error
    cap.on('close', () => {
      if (!running || ws.readyState !== ws.OPEN) return;
      // Step 2: read the captured file back as a binary stream.
      const read = spawn(ADB, ['-s', serial, 'exec-out', 'cat', FRAME_PATH]);
      const chunks = [];
      read.stdout.on('data', (d) => chunks.push(d));
      read.stderr.on('data', () => {});
      read.on('error', () => { if (running) setTimeout(grabFrame, 200); }); // back off on hard error
      read.on('close', () => {
        if (running && ws.readyState === ws.OPEN && chunks.length) {
          ws.send(Buffer.concat(chunks)); // binary PNG frame
        }
        if (running) grabFrame(); // immediately request the next frame
      });
    });
  }
  grabFrame();

  ws.on('message', (msg) => {
    let m;
    try { m = JSON.parse(msg.toString()); } catch { return; }
    const args = ['-s', serial, 'shell', 'input'];
    if (m.type === 'tap') {
      spawn(ADB, [...args, 'tap', String(Math.round(m.x)), String(Math.round(m.y))]);
    } else if (m.type === 'swipe') {
      spawn(ADB, [...args, 'swipe', String(Math.round(m.x1)), String(Math.round(m.y1)),
        String(Math.round(m.x2)), String(Math.round(m.y2)), String(m.dur || 200)]);
    } else if (m.type === 'key') {
      spawn(ADB, [...args, 'keyevent', String(m.code)]);
    } else if (m.type === 'text') {
      const safe = String(m.text).replace(/ /g, '%s').replace(/(["'`$\\&;|<>()])/g, '\\$1');
      spawn(ADB, [...args, 'text', safe]);
    }
  });

  ws.on('close', () => {
    running = false;
    // Restore default animation scales so the device behaves normally again.
    for (const k of ANIM_KEYS) {
      spawn(ADB, ['-s', serial, 'shell', 'settings', 'put', 'global', k, '1']);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  // Start the adb server eagerly so first connect is fast.
  adb(['start-server'], { useTarget: false }).catch(() => {});
  const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', X = '\x1b[0m';
  console.log(`${G}${B}`);
  console.log('   ______               __    ____                ___ __ ');
  console.log('  / ____/________ ___ / /_  / __ )____ _____  ____/ (_) /_');
  console.log('  / /   / ___/ __ `__ \\/ __ \\/ __  / __ `/ __ \\/ __  / / __/');
  console.log(' / /___/ /  / / / / / / /_/ / /_/ / /_/ / / / / /_/ / / /_  ');
  console.log(' \\____/_/  /_/ /_/ /_/_.___/_____/\\__,_/_/ /_/\\__,_/_/\\__/  ');
  console.log(`${X}${R}            >> CrashBandit-ADB-Tool  v1.0.0 <<${X}`);
  console.log(`${G}[INFO]${X} CrashBandit-ADB-Tool Core Initialized...`);
  console.log(`${G}[INFO]${X} Listening on http://0.0.0.0:${PORT}`);
  console.log(`${G}[INFO]${X} adb binary: ${ADB} | server root: ${SERVER_ROOT}`);
  console.log(`${R}[WARN]${X} Raw shell access exposed — keep this on a trusted network only.`);
});
