import fs from 'node:fs/promises';
import path from 'node:path';
const files = {};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain' };
async function collect(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, item.name);
    if (item.isDirectory()) await collect(filename);
    else { const url = '/' + path.relative('dist', filename).split(path.sep).join('/'); files[url] = { data: (await fs.readFile(filename)).toString('base64'), type: types[path.extname(filename)] || 'application/octet-stream' }; }
  }
}
await collect('dist');
const api = await fs.readFile('worker/api.js', 'utf8');
const share = await fs.readFile('worker/share.js', 'utf8');
const source = api + '\n' + share + `\nconst assets = ${JSON.stringify(files)};
export default { async fetch(request, env) {
 const url = new URL(request.url);
 if (url.pathname === '/api/share' || url.pathname.startsWith('/api/share/')) { try { return await handleShare(request, env); } catch { return Response.json({error:'공유 저장소에 연결하지 못했습니다. 다시 시도해 주세요.'},{status:503}); } }
 if (url.pathname === '/api/style' && request.method === 'POST') return handleStyle(request, env);
 if (url.pathname.startsWith('/api/')) return Response.json({error:'API를 찾을 수 없습니다.'},{status:404});
 if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
 const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
 if (!asset) return new Response('Not found',{status:404});
 return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), c=>c.charCodeAt(0)), {headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':url.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'}});
} };`;
await fs.mkdir('dist/server', { recursive: true });
await fs.mkdir('dist/.openai', { recursive: true });
await fs.writeFile('dist/server/index.js', source);
await fs.copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Worker built with embedded frontend assets.');
