require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8765;

const AUTH_USER = process.env.BASIC_AUTH_USER;
const AUTH_PASS = process.env.BASIC_AUTH_PASS;
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);

if (!AUTH_ENABLED) {
  console.warn('[auth] BASIC_AUTH_USER / BASIC_AUTH_PASS 미설정 — 인증 없이 실행됩니다.');
}

const validTokens = new Set();

const LOG_PATH = path.join(__dirname, 'auth.log');
function writeAuthLog(entry) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFile(LOG_PATH, line, err => { if (err) console.error('[log] write error:', err.message); });
  console.log('[auth]', line.trimEnd());
}

// IP 블랙리스트 (파일 영구 보존)
const BLACKLIST_PATH = path.join(__dirname, 'blacklist.json');
let blacklist = new Set();
try {
  const data = JSON.parse(fs.readFileSync(BLACKLIST_PATH, 'utf8'));
  blacklist = new Set(Array.isArray(data) ? data : []);
  if (blacklist.size > 0) console.log(`[auth] blacklist loaded: ${blacklist.size} IP(s)`);
} catch { /* 파일 없으면 빈 Set으로 시작 */ }

function saveBlacklist() {
  fs.writeFile(BLACKLIST_PATH, JSON.stringify([...blacklist], null, 2) + '\n', err => {
    if (err) console.error('[blacklist] write error:', err.message);
  });
}

// 로그인 실패 카운터 (메모리, 재시작 시 초기화)
const loginAttempts = new Map();
const ATTEMPT_RESET_MS = 60 * 60 * 1000; // 1시간 후 카운터 리셋

function getFailCount(ip) {
  const info = loginAttempts.get(ip);
  if (!info) return 0;
  if (Date.now() - info.lastFail > ATTEMPT_RESET_MS) { loginAttempts.delete(ip); return 0; }
  return info.count;
}

function recordFail(ip) {
  const count = getFailCount(ip) + 1;
  loginAttempts.set(ip, { count, lastFail: Date.now() });
  return count;
}

// 실패 횟수별 응답 지연: 3~4회→5초, 5~9회→30초, 10회→블랙리스트
function loginDelay(count) {
  if (count <= 2) return 0;
  if (count <= 4) return 5000;
  return 30000;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

const CLI_PATH = process.env.CLI_PATH ||
    path.join(__dirname, '..', 'swift', '.build', 'release', 'CalendarCLI');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/login
app.post('/api/login', async (req, res) => {
  const ip = getClientIp(req);

  if (AUTH_ENABLED && blacklist.has(ip)) {
    writeAuthLog({ event: 'LOGIN_BLOCKED', ip });
    return res.status(403).json({ error: '접속이 차단된 IP입니다. 관리자에게 문의하세요.' });
  }

  if (!AUTH_ENABLED) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    writeAuthLog({ event: 'LOGIN_SUCCESS', ip, user: '(auth disabled)' });
    return res.json({ token });
  }

  const { user, pass } = req.body;
  if (user === AUTH_USER && pass === AUTH_PASS) {
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    const maskedPass = pass.length > 2 ? pass.slice(0, 2) + '*'.repeat(pass.length - 2) : '**';
    writeAuthLog({ event: 'LOGIN_SUCCESS', ip, user, pass: maskedPass });
    return res.json({ token });
  }

  const count = recordFail(ip);

  if (count >= 10) {
    blacklist.add(ip);
    saveBlacklist();
    writeAuthLog({ event: 'LOGIN_BLACKLISTED', ip, count });
    return res.status(403).json({ error: '접속이 차단된 IP입니다. 관리자에게 문의하세요.' });
  }

  const delay = loginDelay(count);
  writeAuthLog({ event: 'LOGIN_FAIL', ip, user: user || '(empty)', count, delay });
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  const ip = getClientIp(req);
  const [scheme, token] = (req.headers['authorization'] || '').split(' ');
  if (scheme === 'Bearer' && token && validTokens.has(token)) {
    validTokens.delete(token);
    writeAuthLog({ event: 'LOGOUT', ip });
  }
  res.json({ ok: true });
});

// Bearer 토큰 검증 미들웨어 (/api/login, /api/logout 제외)
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (!AUTH_ENABLED) return next();
  const [scheme, token] = (req.headers['authorization'] || '').split(' ');
  if (scheme === 'Bearer' && token && validTokens.has(token)) return next();
  res.status(401).json({ error: '인증이 필요합니다.' });
});

function runCLI(args) {
    return new Promise((resolve, reject) => {
        execFile(CLI_PATH, args, { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error && !stdout) {
                return reject(new Error(stderr || error.message));
            }
            try {
                const result = JSON.parse(stdout);
                if (result && result.error) {
                    return reject(new Error(result.error));
                }
                resolve(result);
            } catch {
                reject(new Error('CLI output parse failed: ' + stdout.slice(0, 200)));
            }
        });
    });
}

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get('/api/events', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end query params are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).json({ error: 'Date format must be YYYY-MM-DD' });
    }
    try {
        const events = await runCLI(['list', '--start', start, '--end', end]);
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/events/:id
app.put('/api/events/*', async (req, res) => {
    const id = decodeURIComponent(req.params[0]);
    const { startTime, endTime, endTimeNextDay, notes, title } = req.body;

    if (!startTime && !endTime && notes === undefined && title === undefined) {
        return res.status(400).json({ error: 'startTime, endTime, notes, or title is required' });
    }
    const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (startTime && !timeRe.test(startTime)) {
        return res.status(400).json({ error: 'startTime format must be HH:mm' });
    }
    if (endTime && !timeRe.test(endTime)) {
        return res.status(400).json({ error: 'endTime format must be HH:mm' });
    }
    const args = ['modify', '--id', id];
    if (startTime)                           args.push('--startTime', startTime);
    if (endTime)                             args.push('--endTime', endTime);
    if (endTime && endTimeNextDay)           args.push('--endDay', '1');
    if (notes !== undefined)                 args.push('--notes', notes);
    if (title !== undefined && title.trim()) args.push('--title', title.trim());

    console.log('[modify] args:', args.map((a, i) => i > 0 && args[i-1] === '--notes' ? `"${a.slice(0,60).replace(/\n/g,'↵')}..."` : a).join(' '));
    try {
        const result = await runCLI(args);
        console.log('[modify] ok:', JSON.stringify(result));
        res.json(result);
    } catch (err) {
        console.error('[modify] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/events/:id
app.delete('/api/events/*', async (req, res) => {
    const id = decodeURIComponent(req.params[0]);
    console.log('[delete] id:', id);
    try {
        const result = await runCLI(['delete', '--id', id]);
        console.log('[delete] ok:', JSON.stringify(result));
        res.json(result);
    } catch (err) {
        console.error('[delete] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/events/:id/analyze — reserved for AI
app.post('/api/events/*/analyze', (req, res) => {
    res.status(501).json({ message: 'AI analysis not yet implemented' });
});

app.listen(PORT, () => {
    console.log(`iCal Manager running at http://localhost:${PORT}`);
    console.log(`CLI path: ${CLI_PATH}`);
    console.log(`[auth] ${AUTH_ENABLED ? '인증 활성화' : '인증 비활성화 (개발 모드)'}`);
});
