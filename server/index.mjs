import http from 'node:http';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleStyle } from '../worker/api.js';
import { handleShare } from '../worker/share.js';

// Local equivalent of the hosted R2 bucket; never committed to source control.
const shareDirectory = fileURLToPath(new URL('../.local-shares/', import.meta.url));
const localBucket = {
  async put(key, value) { await mkdir(shareDirectory, { recursive: true }); await writeFile(path.join(shareDirectory, key.slice(7)), value, { mode: 0o600 }); },
  async get(key) { try { const text = await readFile(path.join(shareDirectory, key.slice(7)), 'utf8'); return { json: async () => JSON.parse(text) }; } catch(e) { if (e.code === 'ENOENT') return null; throw e; } },
  async delete(key) { await unlink(path.join(shareDirectory, key.slice(7))).catch(e => { if (e.code !== 'ENOENT') throw e; }); },
};
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 3001);
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
export const server = http.createServer(async (req, res) => {
  if (req.url === '/api/share' || req.url?.startsWith('/api/share/')) {
    try {
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
      const response = await handleShare(request, { BUCKET: localBucket });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { json(res, 503, { error: '공유 저장소에 연결하지 못했습니다. 다시 시도해 주세요.' }); }
    return;
  }
  if (req.url === '/api/style' && req.method === 'POST') {
    try {
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: req, duplex: 'half' });
      const response = await handleStyle(request, process.env);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { json(res, 502, { error: '스타일을 생성하지 못했습니다. 다시 시도해 주세요.' }); }
    return;
  }
  if (req.url?.startsWith('/api/')) return json(res, 404, { error: 'API를 찾을 수 없습니다.' });
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '허용되지 않은 요청입니다.' });
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const requested = path.resolve(root, '.' + pathname);
    if (requested !== root && !requested.startsWith(root + path.sep)) return json(res, 403, { error: '접근할 수 없습니다.' });
    const filename = path.extname(requested) ? requested : path.join(root, 'index.html');
    const data = await readFile(filename);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch { json(res, 404, { error: '페이지를 찾을 수 없습니다.' }); }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, '0.0.0.0', () => console.log(`Moodhair server: http://localhost:${port}`));
