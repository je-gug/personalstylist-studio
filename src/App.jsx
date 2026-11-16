import { useEffect, useRef, useState } from 'react';
import './App.css';

const suggestions = ['소프트 레이어드', '내추럴 보브', '커튼 뱅', '텍스처 숏컷', '미디엄 웨이브', '슬릭 스트레이트', '볼륨 펌', '프렌치 보브'];
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const positions = [0, 1, 2, 3, 5, 6, 7, 8];
function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }); }
async function prepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 1536 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas'); canvas.width = img.width * scale; canvas.height = img.height * scale;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally { URL.revokeObjectURL(url); }
}
export default function App() {
  const [photo, setPhoto] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  const [shared, setShared] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef();
  const generation = useRef(0);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('share');
    if (!id) return;
    let cancelled = false;
    setBusy(true);
    fetch(`${apiBase}/api/share/${encodeURIComponent(id)}`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '공유 결과를 불러오지 못했습니다.');
      if (!cancelled) { setResult(data); setSelected(data.selected); setShared(true); setShareUrl(window.location.href); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  function resetSharing() { setShareUrl(''); setShareOpen(false); setNotice(''); setShared(false); }
  async function choose(file) {
    if (!file || busy || shareBusy) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('JPG, PNG, WEBP 사진을 선택해 주세요.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('10MB 이하의 사진을 선택해 주세요.'); return; }
    const id = ++generation.current;
    try { const src = await prepare(file); if (generation.current === id) { setPhoto(src); setResult(null); resetSharing(); } }
    catch { setError('사진을 읽을 수 없습니다. 다른 사진을 선택해 주세요.'); }
  }
  function clear() { generation.current++; setPhoto(''); setResult(null); resetSharing(); setError(''); window.history.replaceState(null, '', import.meta.env.BASE_URL); if (fileInput.current) fileInput.current.value = ''; }
  async function generate() {
    setBusy(true); setError(''); resetSharing();
    try {
      const response = await fetch(`${apiBase}/api/style`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: photo, consent: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setResult(data); setSelected(data.best);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function boardCanvas() {
    const img = await loadImage(result.image);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1500;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 1500, 1500);
    if (photo) {
      const original = await loadImage(photo); const side = Math.min(original.width, original.height);
      ctx.drawImage(original, (original.width-side)/2, (original.height-side)/2, side, side, 500, 500, 500, 500);
    }
    return canvas;
  }
  async function download(single = false) {
    setSaving(true); setError('');
    try {
      let canvas = await boardCanvas();
      if (single) {
        const crop = document.createElement('canvas'); crop.width = crop.height = 500;
        const cell = positions[selected];
        crop.getContext('2d').drawImage(canvas, cell % 3 * 500, Math.floor(cell / 3) * 500, 500, 500, 0, 0, 500, 500); canvas = crop;
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), 'image/jpeg', 0.95));
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
      a.download = single ? `moodhair-style-${selected + 1}.jpg` : 'moodhair-board.jpg';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('다운로드를 시작했습니다.');
    } catch { setError('이미지를 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  async function createLink() {
    setShareBusy(true); setError('');
    try {
      const canvas = await boardCanvas();
      const response = await fetch(`${apiBase}/api/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: canvas.toDataURL('image/jpeg', 0.88), styles: result.styles, best: result.best, selected, consent: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '공유 링크를 만들지 못했습니다.');
      setShareUrl(data.url); setNotice('공유 링크를 만들었습니다. 7일 동안 열어볼 수 있어요.');
    } catch(e) { setError(e.message); } finally { setShareBusy(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setNotice('링크를 복사했습니다. 카카오톡 대화나 인스타그램 DM에 붙여넣으세요.'); }
    catch { setNotice('자동 복사를 사용할 수 없습니다. 아래 링크를 길게 누르거나 선택해 복사해 주세요.'); }
  }
  async function nativeShare() {
    if (!navigator.share) { await copyLink(); return; }
    try { await navigator.share({ title: 'moodhair · 나의 헤어스타일', text: '나에게 어울리는 8가지 헤어스타일을 확인해 보세요.', url: shareUrl }); }
    catch(e) { if (e.name !== 'AbortError') setNotice('공유 창을 열 수 없습니다. 링크 복사를 이용해 주세요.'); }
  }
  const styles = result?.styles || suggestions.map(name => ({ name }));
  return <div className="site">
    <header className="header"><a className="brand" href="/">mood<span>hair</span><i>✳</i></a><span className="header-label">PERSONAL HAIR STUDIO</span><span className="private"><span/> 개인정보 입력 없이</span></header>
    <main>
      <section className="intro"><div className="eyebrow">A LITTLE CHANGE, A NEW YOU</div><h1>나에게 어울리는 머리,<br/><em>사진 한 장으로 발견하세요.</em></h1><p>새로운 나를 만나는 8가지 가능성.<br className="mobile"/> 로그인 없이 사진 한 장과 버튼 한 번으로, 나에게 어울리는 8가지 스타일을 만나보세요.</p></section>
      <div className="workspace">
        <aside className="upload-panel"><div className="section-label"><span>01</span> 나의 사진</div><h2>변화의 시작은<br/>사진 한 장이면 충분해요.</h2><p className="muted">얼굴과 머리가 잘 보이는 정면 사진을 준비해 주세요.</p>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" id="photo" className="sr-only" disabled={busy || shareBusy} onChange={e => choose(e.target.files?.[0])}/>
          <label htmlFor="photo" className={`dropzone ${drag ? 'drag' : ''} ${photo ? 'has-photo' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }}>
            {photo ? <><img src={photo} alt="선택한 원본 사진"/><span className="replace">사진 바꾸기 ↗</span></> : <><span className="upload-icon">↥</span><strong>사진을 여기에 놓아주세요</strong><span>또는 클릭해서 사진 선택</span><small>JPG, PNG, WEBP · 최대 10MB</small></>}
          </label>
          <div className="photo-tips"><span>✓ 정면을 바라본 사진</span><span>✓ 밝고 선명한 사진</span></div>
          <p className="consent">버튼을 누르면 사진이 Google Gemini로 전송되어 8가지 헤어스타일과 가장 어울리는 스타일을 자동으로 생성합니다.</p>
          <button className="primary" disabled={!photo || busy || shareBusy} onClick={generate}>{busy ? <><span className="spinner"/> 스타일을 디자인하고 있어요…</> : <>나의 헤어스타일 찾기 <span>↗</span></>}</button>
          {busy && <p className="waiting" role="status">사진 분석과 이미지 생성에 몇 분 걸릴 수 있어요.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="privacy-note"><span>♧</span><p><strong>이름도, 연락처도 필요 없어요.</strong>사진과 결과는 공유 링크를 만들 때만 서버에 저장됩니다. AI 처리 중에는 Google Gemini의 데이터 정책이 적용됩니다.</p></div>
          {(photo || shared) && <button className="clear" onClick={clear} disabled={busy || shareBusy}>사진과 결과 지우기</button>}
        </aside>
        <section className="result-panel"><div className="result-heading"><div><div className="section-label"><span>02</span> 나의 스타일 보드</div><h2>같은 나, 새로운 분위기.</h2></div><span className="count">8 STYLES + YOU</span></div>
          <div className={`style-grid ${busy ? 'generating' : ''}`} aria-label="중앙 원본 사진과 주변 8개 헤어스타일">
            {Array.from({ length: 9 }, (_, cell) => {
              if (cell === 4) return <div className="original tile" key="original">{photo ? <img src={photo} alt="원본 사진"/> : shared ? <div className="generated-photo" role="img" aria-label="공유된 원본 사진" style={{ backgroundImage: `url(${result.image})`, backgroundPosition: '50% 50%' }}/> : <div className="original-empty"><span>YOU</span><small>이곳에 나의 사진이</small></div>}<span className="tile-label original-label">ORIGINAL · 나의 모습</span></div>;
              const idx = positions.indexOf(cell); const style = styles[idx];
              return <button key={cell} className={`tile style-tile style-${idx} ${result && selected === idx ? 'selected' : ''}`} disabled={!result || busy || shareBusy} aria-label={`${style.name}${result?.best === idx ? ', 가장 추천하는 스타일' : ''}`} onClick={() => { setSelected(idx); if (!shared) setShareUrl(''); }}>
                {result ? <div className="generated-photo" style={{ backgroundImage: `url(${result.image})`, backgroundPosition: `${cell % 3 * 50}% ${Math.floor(cell / 3) * 50}%` }}/> : <div className={`hair-sketch hair-${idx}`} aria-hidden="true"><div className="shoulders"/><div className="neck"/><div className="hair-back"/><div className="face"/><div className="hair-front"/></div>}
                <span className="style-number">0{idx + 1}</span>{result?.best === idx && <span className="best-tag">✦ BEST</span>}<span className="tile-label">{style.name}</span>
              </button>;
            })}
            {busy && <div className="grid-loading"><span className="spinner"/><strong>8가지 새로운 모습을 만드는 중</strong><span>잠시만 기다려 주세요</span></div>}
          </div>
          {!result && <p className="board-caption"><span>✧</span> 위 그림은 스타일 예시입니다. 사진을 선택하고 생성하면 나의 모습으로 바뀌어요.</p>}
          {result ? <div className="recommendation"><div className="rec-icon">✦</div><div><span className="eyebrow">{selected === result.best ? 'YOUR BEST MATCH' : 'STYLE DETAILS'}</span><h3>{styles[selected].name}</h3><p>{styles[selected].reason}</p><small>AI의 미적 제안으로, 실제 시술 결과와 다를 수 있어요.</small></div></div> : <div className="empty-recommendation"><span>✦</span><div><strong>8가지 중, 나를 가장 빛나게 하는 하나.</strong><p>생성 후 가장 잘 어울리는 스타일과 추천 이유를 알려드려요.</p></div></div>}
          {result && <div className="result-actions" aria-label="결과 다운로드 및 공유">
            <button className="download" disabled={saving || busy} onClick={() => download()}>전체 보드 다운로드 ↓</button>
            <button className="download" disabled={saving || busy} onClick={() => download(true)}>선택한 스타일 다운로드 ↓</button>
            <button className="download share-trigger" disabled={busy || shareBusy} aria-expanded={shareOpen} onClick={() => setShareOpen(!shareOpen)}>결과 링크 공유 ↗</button>
          </div>}
          {result && shareOpen && <section className="share-panel" aria-label="결과 링크 공유">
            <h3>마음에 드는 스타일, 함께 골라보세요.</h3>
            {!shareUrl ? <><p>링크를 만들면 원본 얼굴 사진이 포함된 보드와 추천 이유가 서버에 저장되며, 링크를 아는 누구나 7일 동안 볼 수 있어요.</p><button className="download" onClick={createLink} disabled={shareBusy || busy}>{shareBusy ? '공유 링크 만드는 중…' : '사진 저장에 동의하고 링크 만들기'}</button></> : <>
              <label htmlFor="share-url">공유 링크</label><input id="share-url" readOnly value={shareUrl} onFocus={e => e.target.select()}/>
              <div className="result-actions"><button className="download" onClick={copyLink}>링크 복사</button><button className="download" onClick={nativeShare}>앱으로 공유</button></div>
              <p>카카오톡 대화·인스타그램 DM에 링크를 붙여넣으세요. 휴대폰의 공유 창에서도 앱을 선택할 수 있어요. 표시되는 앱은 기기에 따라 달라요. 인스타그램 스토리는 보드를 저장한 뒤 링크 스티커를 추가해 주세요.</p>
            </>}
          </section>}
          {notice && <p className="share-notice" role="status">{notice}</p>}
        </section>
      </div>
      <section className="steps"><div><span>01 / UPLOAD</span><h3>내 사진 한 장</h3><p>로그인이나 개인정보 입력 없이 사진만 선택하세요.</p></div><div><span>02 / DISCOVER</span><h3>8가지 새로운 스타일</h3><p>나의 얼굴은 그대로, 헤어스타일만 새롭게.</p></div><div><span>03 / FIND YOUR MOOD</span><h3>가장 나다운 선택</h3><p>추천 이유를 확인하고 보드를 저장하세요.</p></div></section>
    </main><footer><a className="brand" href="/">mood<span>hair</span><i>✳</i></a><p>작은 변화로 발견하는, 새로운 나.</p><span>YOUR NEXT LOOK STARTS HERE.</span></footer>
  </div>;
}
