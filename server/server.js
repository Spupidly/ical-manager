const express = require('express');
const { execFile } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;

const CLI_PATH = process.env.CLI_PATH ||
    path.join(__dirname, '..', 'swift', '.build', 'release', 'CalendarCLI');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// PUT /api/events/:id  { startTime?: "HH:mm", endTime?: "HH:mm" }
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
});
