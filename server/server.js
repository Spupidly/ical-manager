require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;

const AUTH_USER = process.env.BASIC_AUTH_USER;
const AUTH_PASS = process.env.BASIC_AUTH_PASS;
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);

if (!AUTH_ENABLED) {
  console.warn('[auth] BASIC_AUTH_USER / BASIC_AUTH_PASS 미설정 — 인증 없이 실행됩니다.');
}

const validTokens = new Set();

const CLI_PATH = process.env.CLI_PATH ||
    path.join(__dirname, '..', 'swift', '.build', 'release', 'CalendarCLI');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/login
app.post('/api/login', (req, res) => {
  if (!AUTH_ENABLED) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    return res.json({ token });
  }
  const { user, pass } = req.body;
  if (user === AUTH_USER && pass === AUTH_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
});

// Bearer 토큰 검증 미들웨어 (/api/login 제외)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  if (!AUTH_ENABLED) return next();
  const [scheme, token] = (req.headers['authorization'] || '').split(' ');
  if (scheme === 'Bearer' && token && validTokens.has(token)) return next();
  res.status(401).json({ error: '인증이 필요합니다.' });
});

function runCLI(args) {
    return new Promise((resolve, reject) => {
        execFile(CLI_PATH, args, { timeout: 30000 }, (error, stdout, stderr) => {
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
    const { startTime, endTime, notes, title } = req.body;

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

// POST /api/events/:id/analyze — reserved for AI
app.post('/api/events/*/analyze', (req, res) => {
    res.status(501).json({ message: 'AI analysis not yet implemented' });
});

app.listen(PORT, () => {
    console.log(`iCal Manager running at http://localhost:${PORT}`);
    console.log(`CLI path: ${CLI_PATH}`);
    console.log(`[auth] ${AUTH_ENABLED ? '인증 활성화' : '인증 비활성화 (개발 모드)'}`);
});
