// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { handleStyle } from './api.js';
const request = (body = { image: 'data:image/jpeg;base64,/9j/', consent: true }) => new Request('https://example.com/api/style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());
test('requires consent before sending a photo to OpenAI', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await handleStyle(request({ image: 'data:image/jpeg;base64,/9j/', consent: false }), { OPENAI_API_KEY: 'test' })).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
test('returns eight styles and the selected best match from OpenAI', async () => {
  const styles = Array.from({ length: 8 }, (_, i) => ({ name: `스타일 ${i}`, reason: '얼굴 주변 볼륨을 부드럽게 조절합니다.', edit: `Hairstyle ${i}` }));
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ valid: true, best: 3, styles }) } }] })).mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'cGljdHVyZQ==' }] }));
  vi.stubGlobal('fetch', fetch);
  const response = await handleStyle(request(), { OPENAI_API_KEY: 'test' });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.styles).toHaveLength(8); expect(data.best).toBe(3); expect(data.image).toBe('data:image/png;base64,cGljdHVyZQ==');
  expect(fetch.mock.calls[1][1].body.get('image')).toBeInstanceOf(Blob);
});
test('reports an invalid API key without exposing upstream details or secrets', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'sensitive upstream detail' } }, { status: 401 })));
  const response = await handleStyle(request(), { OPENAI_API_KEY: 'test-secret' });
  const text = await response.text();
  expect(response.status).toBe(502); expect(text).toContain('API 키가 유효하지 않습니다'); expect(text).not.toContain('test-secret'); expect(text).not.toContain('sensitive upstream detail');
});
