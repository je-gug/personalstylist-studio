import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import App from './App';

test('requires only a photo and does not ask for personal information', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /나의 헤어스타일 찾기/ }).disabled).toBe(true);
  expect(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="checkbox"]')).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: /소프트 레이어드|내추럴 보브|커튼 뱅|텍스처 숏컷|미디엄 웨이브|슬릭 스트레이트|볼륨 펌|프렌치 보브/ })).toHaveLength(8);
  cleanup();
});
test('rejects unsupported upload without sending it to a server', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  render(<App />);
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['bad'], 'photo.txt', { type: 'text/plain' })] } });
  expect(screen.getByRole('alert').textContent).toContain('JPG, PNG, WEBP');
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore(); cleanup();
});

test('one button sends the selected photo and displays all eight recommendations without questions', async () => {
  vi.stubGlobal('Image', class { width = 800; height = 800; set src(value) { queueMicrotask(() => this.onload()); } });
  const createURL = URL.createObjectURL; const revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:portrait'); URL.revokeObjectURL = vi.fn();
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/');
  const styles = Array.from({ length: 8 }, (_, i) => ({ name: `추천 ${i + 1}`, reason: `스타일 이유 ${i + 1}` }));
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ styles, best: 2, image: 'data:image/png;base64,cGlj' }) });
  try {
    render(<App />);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } });
    const button = screen.getByRole('button', { name: /나의 헤어스타일 찾기/ });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByRole('button', { name: '추천 3, 가장 추천하는 스타일' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ image: 'data:image/jpeg;base64,/9j/', consent: true });
    expect(screen.getAllByRole('button', { name: /^추천/ })).toHaveLength(8);
    expect(screen.getByText('스타일 이유 3')).toBeDefined();
    await waitFor(() => expect(screen.getByRole('button', { name: '결과 링크 공유 ↗' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '결과 링크 공유 ↗' }));
    expect(screen.getByText(/원본 얼굴 사진이 포함된/)).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://example.com/?share=test' }) });
    fireEvent.click(screen.getByRole('button', { name: '사진 저장에 동의하고 링크 만들기' }));
    await screen.findByDisplayValue('https://example.com/?share=test');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ consent: true, selected: 2, best: 2, styles });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: '선택한 스타일 다운로드 ↓' }));
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      expect(click.mock.instances[0].download).toBe('moodhair-style-3.jpg');
      expect(context.mock.results[0].value.drawImage).toHaveBeenCalledWith(expect.anything(), 1000, 0, 500, 500, 0, 0, 500, 500);
    } finally { toBlob.mockRestore(); click.mockRestore(); }

  } finally {
    cleanup(); fetch.mockRestore(); context.mockRestore(); canvas.mockRestore(); vi.unstubAllGlobals();
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
});

test('opens a shared board and supports copy and native share without regenerating', async () => {
  window.history.replaceState(null, '', '/?share=shared-result');
  const styles = Array.from({ length: 8 }, (_, i) => ({ name: `공유 스타일 ${i}`, reason: `공유 이유 ${i}` }));
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ image: 'data:image/jpeg;base64,cGlj', styles, best: 1, selected: 3 }) });
  const writeText = vi.fn().mockResolvedValue(); const share = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  try {
    render(<App />);
    await screen.findByText('공유 이유 3');
    expect(fetch).toHaveBeenCalledWith('/api/share/shared-result');
    expect(screen.getByRole('img', { name: '공유된 원본 사진' })).toBeDefined();
    await waitFor(() => expect(screen.getByRole('button', { name: '결과 링크 공유 ↗' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '결과 링크 공유 ↗' }));
    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    fireEvent.click(screen.getByRole('button', { name: '앱으로 공유' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href }));
    expect(screen.getByRole('button', { name: '전체 보드 다운로드 ↓' })).toBeDefined();
    expect(screen.getByRole('button', { name: '선택한 스타일 다운로드 ↓' })).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { cleanup(); fetch.mockRestore(); delete navigator.clipboard; delete navigator.share; window.history.replaceState(null, '', '/'); }
});
