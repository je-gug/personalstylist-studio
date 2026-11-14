import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import App from './App';

test('requires photo and consent and does not ask for personal information', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /나의 헤어스타일 찾기/ }).disabled).toBe(true);
  expect(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')).toHaveLength(0);
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
