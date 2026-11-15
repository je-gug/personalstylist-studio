import http from 'node:http';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
let active = 0;
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
async function openai(endpoint, options) {
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, { ...options, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...options.headers }, signal: AbortSignal.timeout(300000) });
  const data = await response.json();
  if (!response.ok) {
    const messages = {
      401: 'OpenAI API 키가 유효하지 않습니다. 운영자가 .env의 OPENAI_API_KEY를 확인하고 서버를 재시작해 주세요.',
      403: 'OpenAI 모델 접근 권한이 없습니다. 운영자가 이미지 생성 모델의 사용 권한을 확인해 주세요.',
      429: 'OpenAI 사용 한도 또는 요청 제한에 도달했습니다. 운영자가 API 결제와 사용 한도를 확인해 주세요.',
    };
    const error = new Error(messages[response.status] || 'OpenAI에서 사진을 처리하지 못했습니다. 다른 사진으로 다시 시도해 주세요.');
    error.publicMessage = true;
    throw error;
  }
  return data;
}
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
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '허용되지 않은 요청입니다.' });
    if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: '아직 AI 생성 서비스가 연결되지 않았어요. 운영자가 서버에 OPENAI_API_KEY를 설정하면 사용할 수 있습니다.' });
    if (active >= 2) return json(res, 429, { error: '현재 다른 사진을 생성 중입니다. 잠시 후 다시 시도해 주세요.' });
    active++;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) { json(res, 413, { error: '사진이 너무 큽니다. 더 작은 사진을 선택해 주세요.' }); return; } chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json(res, 400, { error: '잘못된 요청입니다.' }); }
      if (body.consent !== true || typeof body.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image)) return json(res, 400, { error: '사진과 AI 전송 동의를 확인해 주세요.' });
      const analysis = await openai('chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini', store: false,
        messages: [{ role: 'system', content: 'You are a hairstylist. Only discuss visible hair, face proportions, and styling, never identity or sensitive traits. If the image is not a clear single human portrait, set valid=false, styles=[], best=0. Otherwise propose exactly 8 distinct realistic hairstyles suitable for the person, avoiding gender assumptions. Write names and reasons in Korean. Each reason explains styling balance and maintenance. The recommendation is subjective. best is a zero-based index. edit is a concise English image-edit instruction for the hairstyle.' }, { role: 'user', content: [{ type: 'text', text: '이 사진의 사람에게 어울리는 서로 다른 헤어스타일 8개를 제안하고 가장 추천하는 하나를 골라주세요.' }, { type: 'image_url', image_url: { url: body.image } }] }],
        response_format: { type: 'json_schema', json_schema: { name: 'hairstyles', strict: true, schema: { type: 'object', additionalProperties: false, properties: { valid: { type: 'boolean' }, best: { type: 'integer' }, styles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, reason: { type: 'string' }, edit: { type: 'string' } }, required: ['name', 'reason', 'edit'] } } }, required: ['valid', 'best', 'styles'] } } }
      }) });
      const plan = JSON.parse(analysis.choices?.[0]?.message?.content || '{}');
      if (!plan.valid || plan.styles?.length !== 8 || !Number.isInteger(plan.best) || plan.best < 0 || plan.best > 7) return json(res, 422, { error: '얼굴과 머리가 잘 보이는 한 사람의 정면 사진을 선택해 주세요.' });
      const form = new FormData();
      form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5');
      form.append('image', new Blob([Buffer.from(body.image.split(',')[1], 'base64')], { type: 'image/jpeg' }), 'portrait.jpg');
      form.append('size', '1024x1024'); form.append('quality', 'medium');
      form.append('prompt', `Create a photorealistic square contact sheet in an EXACT edge-to-edge 3 by 3 grid of equal square cells. No borders, gaps, text, numbers, labels or watermarks. Every cell shows the SAME person from the reference, preserving facial identity, skin tone, clothes, pose and background. Change ONLY the hair. Center cell: unchanged original hairstyle. Around it, in row-major order skipping center, apply these 8 styles: ${plan.styles.map((s, i) => `${i + 1}: ${s.edit}`).join('; ')}. Keep the full hairstyle visible in each square. Each cell must align exactly on thirds of the full image.`);
      const generated = await openai('images/edits', { method: 'POST', body: form });
      if (!generated.data?.[0]?.b64_json) throw new Error('이미지를 생성하지 못했습니다. 다시 시도해 주세요.');
      return json(res, 200, { image: `data:image/png;base64,${generated.data[0].b64_json}`, best: plan.best, styles: plan.styles.map(({ name, reason }) => ({ name, reason })) });
    } catch (error) { return json(res, 502, { error: error.publicMessage ? error.message : error.name === 'TimeoutError' ? '이미지 생성 시간이 초과됐습니다. 다시 시도해 주세요.' : error.message === 'fetch failed' ? 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '스타일을 생성하지 못했습니다. 사진 또는 서버 API 설정을 확인하고 다시 시도해 주세요.' }); }
    finally { active--; }
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
