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

// PUT /api/events/:id  { endTime: "HH:mm" }
app.put('/api/events/*', async (req, res) => {
    const id = decodeURIComponent(req.params[0]);
    const { endTime } = req.body;

    if (!endTime) {
        return res.status(400).json({ error: 'endTime is required' });
    }
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(endTime)) {
        return res.status(400).json({ error: 'endTime format must be HH:mm' });
    }
    try {
        const result = await runCLI(['modify', '--id', id, '--endTime', endTime]);
        res.json(result);
    } catch (err) {
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
