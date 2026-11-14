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
  } finally {
    cleanup(); fetch.mockRestore(); context.mockRestore(); canvas.mockRestore(); vi.unstubAllGlobals();
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
});
