const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 5000;

// Connect to Render Postgres - gembu-db
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        pu_id TEXT,
        constituency TEXT,
        ward TEXT,
        bvas_accredited INT DEFAULT 0,
        rejected_votes INT DEFAULT 0,
        scores JSONB DEFAULT '{}',
        total_votes INT DEFAULT 0,
        photo_url TEXT,
        is_over_voting BOOLEAN DEFAULT false,
        forensic_flags TEXT[] DEFAULT '{}',
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DB] Table ready');
  } catch (e) {
    console.error('[DB] Init failed:', e.message);
  }
}
initDb();

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

  // Serve ANY image in main folder - titong.jpg, etc.
  if (req.method === 'GET' && (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.png') || pathname.endsWith('.webp'))) {
    const filePath = path.join(__dirname, pathname);
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
    req.on('data', chunk => { body.push(chunk); });
    req.on('end', async () => {
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

        // SAVE TO POSTGRES - not data.json
        const insert = await pool.query(
          `INSERT INTO results (pu_id, constituency, ward, bvas_accredited, rejected_votes, scores, total_votes, photo_url, is_over_voting, forensic_flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [pu_id, constituency, ward, bvas_accredited, rejected_votes, JSON.stringify(scores), absoluteTotalVotes, photo_url, isOverVoting, forensicFlags]
        );

        console.log(`[SUCCESS] Result logged for PU ID: ${pu_id} [Ward: ${ward}] | Total Votes: ${absoluteTotalVotes}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'Result collated successfully.',
          record_id: insert.rows[0].id
        }));
      } catch (err) {
        console.error("Submission Error:", err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message || 'Invalid payload' }));
      }
    });
  }
  else if (req.method === 'GET' && pathname === '/results') {
    (async () => {
      try {
        const constituencyQuery = searchParams.get('constituency');
        let q = 'SELECT * FROM results ORDER BY id ASC';
        let params = [];
        if (constituencyQuery) {
          q = 'SELECT * FROM results WHERE LOWER(constituency) = LOWER($1) ORDER BY id ASC';
          params = [constituencyQuery];
        }
        const { rows } = await pool.query(q, params);
        const results = rows.map(r => ({
          id: r.id,
          pu_id: r.pu_id,
          constituency: r.constituency,
          ward: r.ward,
          bvas_accredited: r.bvas_accredited,
          rejected_votes: r.rejected_votes,
          scores: r.scores,
          total_votes: r.total_votes,
          photo_url: r.photo_url,
          is_over_voting: r.is_over_voting,
          forensic_flags: r.forensic_flags || [],
          timestamp: r.timestamp
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_submitting_units: results.length, results: results }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: e.message }));
      }
    })();
  }
  else if (req.method === 'GET' && pathname === '/export/csv') {
    (async () => {
      try {
        const { rows } = await pool.query('SELECT * FROM results ORDER BY id ASC');
        let csvHeader = "ID,PU_ID,Constituency,Ward,BVAS_Accredited,Total_Votes,Rejected,Over_Voting,Photo_URL,Forensic_Flags,Timestamp\n";
        let csvRows = rows.map(r =>
          `${r.id},${r.pu_id},"${r.constituency || 'Gembu'}","${r.ward}",${r.bvas_accredited},${r.total_votes},${r.rejected_votes},${r.is_over_voting},"${r.photo_url || ''}","${(r.forensic_flags || []).join(';')}",${r.timestamp}`
        ).join("\n");
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=gembu_constituency_collation.csv'
        });
        res.end(csvHeader + csvRows);
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ status: 'error', message: e.message }));
      }
    })();
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Endpoint not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Gembu War Room Postgres Backend running on port ${PORT}`);
});
