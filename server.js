const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Load saved results from file - so data survives restart
let submittedResults = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    submittedResults = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`[LOAD] Restored ${submittedResults.length} results from data.json`);
  }
} catch (e) {
  submittedResults = [];
}

function saveResults() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(submittedResults, null, 2));
  } catch (e) { console.error('Save failed:', e.message); }
}

const parseUrl = (reqUrl) => {
    const parsed = new URL(reqUrl, `http://localhost:${PORT}`);
    return { pathname: parsed.pathname, searchParams: parsed.searchParams };
};

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const { pathname, searchParams } = parseUrl(req.url);

    // Serve Live Analytics Dashboard as the root homepage
    if (req.method === 'GET' && pathname === '/') {
        const filePath = path.join(__dirname, 'dashboard.html');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(filePath).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'dashboard.html not found' }));
            return;
        }
    }

    // Serve Situation Entry Console at /situation-entry.html
    if (req.method === 'GET' && pathname === '/situation-entry.html') {
        const filePath = path.join(__dirname, 'situation-entry.html');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(filePath).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'situation-entry.html not found' }));
            return;
        }
    }

    if (req.method === 'GET' && pathname === '/dashboard.html') {
        const filePath = path.join(__dirname, 'dashboard.html');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(filePath).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'dashboard.html not found' }));
            return;
        }
    }

    // FIX 1: Serve ANY image in main folder - titong.jpg, etc.
    if (req.method === 'GET' && (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.png') || pathname.endsWith('.webp'))) {
        const filePath = path.join(__dirname, pathname);
        // Prevent path traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
            fs.createReadStream(filePath).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Image not found: ' + pathname }));
            return;
        }
    }

    // Serve uploaded images statically
    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, pathname);
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Image not found' }));
            return;
        }
    }

    // API Endpoint to receive results from Situation Room Console
    if (req.method === 'POST' && pathname === '/submit') {
        let body = [];
        
        req.on('data', chunk => {
            body.push(chunk);
        });

        req.on('end', () => {
            try {
                const bufferBody = Buffer.concat(body);
                const contentType = req.headers['content-type'] || '';

                let pu_id, constituency, ward, bvas_accredited, total_votes, rejected_votes, scores, photo_url = null;
                let forensicFlags = [];
                let isOverVoting = false;

                if (contentType.includes('multipart/form-data')) {
                    const boundary = contentType.split('boundary=')[1];
                    const parts = bufferBody.toString('binary').split('--' + boundary);

                    const fields = {};
                    let fileBuffer = null;
                    let filename = '';

                    parts.forEach(part => {
                        if (part.includes('Content-Disposition')) {
                            const nameMatch = part.match(/name="([^"]+)"/);
                            if (nameMatch) {
                                const name = nameMatch[1];
                                if (part.includes('filename="')) {
                                    const fileMatch = part.match(/filename="([^"]+)"/);
                                    if (fileMatch && fileMatch[1]) {
                                        filename = fileMatch[1];
                                        const contentMatch = part.split('\r\n\r\n')[1];
                                        if (contentMatch) {
                                            fileBuffer = Buffer.from(contentMatch.substring(0, contentMatch.lastIndexOf('\r\n')), 'binary');
                                        }
                                    }
                                } else {
                                    const value = part.split('\r\n\r\n')[1]?.replace('\r\n', '').trim();
                                    fields[name] = value;
                                }
                            }
                        }
                    });

                    pu_id = fields.pu_id;
                    constituency = fields.constituency || 'Gembu';
                    ward = fields.ward || 'Gembu A';
                    bvas_accredited = parseInt(fields.bvas_accredited) || 0;
                    total_votes = parseInt(fields.total_votes) || 0;
                    rejected_votes = parseInt(fields.rejected_votes) || 0;
                    scores = fields.scores ? JSON.parse(fields.scores) : {};

                    if (fileBuffer && filename) {
                        const cleanPuId = (pu_id || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
                        const savedFilename = `ec8a_${cleanPuId}_${Date.now()}.jpg`;
                        const uploadDir = path.join(__dirname, 'uploads');
                        
                        if (!fs.existsSync(uploadDir)) {
                            fs.mkdirSync(uploadDir, { recursive: true });
                        }

                        fs.writeFileSync(path.join(uploadDir, savedFilename), fileBuffer);
                        photo_url = `/uploads/${savedFilename}`;
                    }
                } else {
                    const data = JSON.parse(bufferBody.toString());
                    pu_id = data.pu_id;
                    constituency = data.constituency || 'Gembu';
                    ward = data.ward || 'Gembu A';
                    bvas_accredited = parseInt(data.bvas_accredited) || 0;
                    rejected_votes = parseInt(data.rejected_votes) || 0;
                    scores = data.scores || {};
                    total_votes = data.total_votes || 0;
                    photo_url = data.photo_url || null;
                }

                const totalPartyVotes = Object.values(scores || {}).reduce((a, b) => a + b, 0);
                const absoluteTotalVotes = totalPartyVotes + (parseInt(rejected_votes) || 0);

                if (absoluteTotalVotes > (bvas_accredited || 0)) {
                    isOverVoting = true;
                    forensicFlags.push("OVER_VOTING_DETECTED");
                }

                if (absoluteTotalVotes > 0 && ((parseInt(rejected_votes) || 0) / absoluteTotalVotes) > 0.25) {
                    forensicFlags.push("HIGH_REJECTION_RATE_ANOMALY");
                }

                const resultRecord = {
                    id: submittedResults.length + 1,
                    pu_id,
                    constituency,
                    ward,
                    bvas_accredited,
                    rejected_votes,
                    scores,
                    total_votes: absoluteTotalVotes,
                    photo_url: photo_url,
                    is_over_voting: isOverVoting,
                    forensic_flags: forensicFlags,
                    timestamp: new Date().toISOString()
                };

                submittedResults.push(resultRecord);
                saveResults(); // FIX 2: Save to data.json immediately
                console.log(`[SUCCESS] Result logged for PU ID: ${pu_id} [Ward: ${ward}] | Total Votes: ${absoluteTotalVotes}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'success',
                    message: 'Result collated successfully.',
                    record_id: resultRecord.id
                }));
            } catch (err) {
                console.error("Submission Error:", err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: err.message || 'Invalid payload' }));
            }
        });
    } 
    else if (req.method === 'GET' && pathname === '/results') {
        let results = submittedResults;
        const constituencyQuery = searchParams.get('constituency');
        
        if (constituencyQuery) {
            results = submittedResults.filter(r => 
                (r.constituency && r.constituency.toLowerCase() === constituencyQuery.toLowerCase()) ||
                (r.lga && r.lga.toLowerCase() === constituencyQuery.toLowerCase())
            );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            total_submitting_units: results.length,
            results: results
        }));
    } 
    else if (req.method === 'GET' && pathname === '/export/csv') {
        let csvHeader = "ID,PU_ID,Constituency,Ward,BVAS_Accredited,Total_Votes,Rejected,Over_Voting,Photo_URL,Forensic_Flags,Timestamp\n";
        let csvRows = submittedResults.map(r => 
            `${r.id},${r.pu_id},"${r.constituency || 'Gembu'}","${r.ward}",${r.bvas_accredited},${r.total_votes},${r.rejected_votes},${r.is_over_voting},"${r.photo_url || ''}","${r.forensic_flags.join(';')}",${r.timestamp}`
        ).join("\n");

        res.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=gembu_constituency_collation.csv'
        });
        res.end(csvHeader + csvRows);
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Endpoint not found' }));
    }
});

server.listen(PORT, () => {
    console.log(`Gembu War Room Zero-Dependency Backend running on port ${PORT} | Loaded ${submittedResults.length} results`);
});
