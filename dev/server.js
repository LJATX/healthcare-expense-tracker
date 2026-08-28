// Local dev harness: serves public/ and routes /api/* to the same function
// handlers Netlify runs, with Blobs backed by the local filesystem
// (LOCAL_BLOBS_DIR). Not used in production.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);

process.env.LOCAL_DEV = process.env.LOCAL_DEV || '1';
process.env.LOCAL_BLOBS_DIR = process.env.LOCAL_BLOBS_DIR || path.join(__dirname, '.data');

const functions = [];
for (const file of await fs.readdir(path.join(ROOT, 'netlify/functions'))) {
  if (!file.endsWith('.js')) continue;
  const mod = await import(path.join(ROOT, 'netlify/functions', file));
  const paths = Array.isArray(mod.config?.path) ? mod.config.path : [mod.config?.path].filter(Boolean);
  for (const p of paths) {
    const pattern = new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$');
    functions.push({ pattern, handler: mod.default });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const route = functions.find((f) => f.pattern.test(url.pathname));
    if (route) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      });
      const response = await route.handler(request);
      const headers = {};
      response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length) headers['set-cookie'] = setCookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // static files
    let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    try {
      const data = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  }
}).listen(PORT, () => {
  console.log(`Healthcare Expense dev server → http://localhost:${PORT}`);
});
