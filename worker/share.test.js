// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { handleShare } from './share.js';
const body = { consent: true, image: 'data:image/jpeg;base64,cGlj', best: 2, selected: 4, styles: Array.from({ length: 8 }, (_, i) => ({ name: `스타일 ${i}`, reason: '추천 이유' })) };
function bucket() {
  const objects = new Map();
  return { put: vi.fn(async (key, value) => objects.set(key, value)), get: vi.fn(async key => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null), delete: vi.fn(async key => objects.delete(key)) };
}
function post(data = body, origin = 'https://example.com') { return new Request('https://example.com/api/share', { method: 'POST', headers: { origin }, body: JSON.stringify(data) }); }
afterEach(() => vi.useRealTimers());
test('persists a share and restores the exact result for another visitor', async () => {
  const env = { BUCKET: bucket() };
  const response = await handleShare(post(), env);
  expect(response.status).toBe(201);
  const { url } = await response.json();
  const id = new URL(url).searchParams.get('share');
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  const result = await handleShare(new Request(`https://example.com/api/share/${id}`), env);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toMatchObject({ image: body.image, best: 2, selected: 4, styles: body.styles });
});
test('rejects missing consent, invalid input, oversized uploads and cross-origin writes', async () => {
  const env = { BUCKET: bucket() };
  for (const data of [{ ...body, consent: false }, { ...body, selected: 8 }, { ...body, image: 'https://other/image' }, { ...body, styles: [null] }]) expect((await handleShare(post(data), env)).status).toBe(400);
  expect((await handleShare(post(body, 'https://other.com'), env)).status).toBe(403);
  expect((await handleShare(post({ ...body, image: 'x'.repeat(6 * 1024 * 1024) }), env)).status).toBe(413);
  expect(env.BUCKET.put).not.toHaveBeenCalled();
});
test('blocks and removes an expired result, and reports missing results and storage', async () => {
  vi.useFakeTimers();
  const env = { BUCKET: bucket() };
  const { url } = await (await handleShare(post(), env)).json();
  const id = new URL(url).searchParams.get('share');
  const request = () => new Request(`https://example.com/api/share/${id}`);
  vi.advanceTimersByTime(7 * 86400000);
  expect((await handleShare(request(), env)).status).toBe(410);
  expect(env.BUCKET.delete).toHaveBeenCalledOnce();
  expect((await handleShare(request(), env)).status).toBe(404);
  expect((await handleShare(post(), {})).status).toBe(503);
});
