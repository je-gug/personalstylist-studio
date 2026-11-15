const reply = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const ttl = 7 * 24 * 60 * 60 * 1000;
export async function handleShare(request, env) {
  const url = new URL(request.url);
  if (!env.BUCKET) return reply(503, { error: '공유 저장소가 연결되지 않았습니다.' });
  if (request.method === 'POST' && url.pathname === '/api/share') {
    if (request.headers.get('origin') !== url.origin) return reply(403, { error: '허용되지 않은 요청입니다.' });
    let size = 0; const chunks = [];
    for await (const chunk of request.body || []) {
      size += chunk.length;
      if (size > 6 * 1024 * 1024) return reply(413, { error: '공유 이미지가 너무 큽니다.' });
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(await new Blob(chunks).text()); } catch { return reply(400, { error: '잘못된 요청입니다.' }); }
    if (!data || data.consent !== true || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image || '') || !Array.isArray(data.styles) || data.styles.length !== 8 || data.styles.some(s => !s || typeof s.name !== 'string' || s.name.length > 100 || typeof s.reason !== 'string' || s.reason.length > 2000) || !Number.isInteger(data.best) || data.best < 0 || data.best > 7 || !Number.isInteger(data.selected) || data.selected < 0 || data.selected > 7) return reply(400, { error: '공유할 결과를 확인해 주세요.' });
    const id = crypto.randomUUID(); const expiresAt = Date.now() + ttl;
    await env.BUCKET.put(`shares/${id}`, JSON.stringify({ image: data.image, styles: data.styles.map(({ name, reason }) => ({ name, reason })), best: data.best, selected: data.selected, expiresAt }));
    return reply(201, { url: `${url.origin}/?share=${id}`, expiresAt });
  }
  const match = /^\/api\/share\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (request.method === 'GET' && match) {
    const key = `shares/${match[1]}`;
    const object = await env.BUCKET.get(key);
    if (!object) return reply(404, { error: '공유 결과를 찾을 수 없습니다.' });
    const data = await object.json();
    if (data.expiresAt <= Date.now()) { await env.BUCKET.delete(key); return reply(410, { error: '공유 링크가 만료되었습니다. 새 결과를 만들어 주세요.' }); }
    return reply(200, data);
  }
  return reply(405, { error: '허용되지 않은 요청입니다.' });
}
