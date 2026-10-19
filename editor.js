import { api, toast, getPass, setPass, formatTime } from './common.js';

const MAX_IMAGES = 9;
const TARGET = 120 * 1024;
const MAX_SIDE = 1600;
const Q_HI = 0.9;
const Q_LO = 0.55;
const SHRINK = 0.8;

const gate = document.getElementById('gate');
const composer = document.getElementById('composer');
const passInput = document.getElementById('passInput');
const passBtn = document.getElementById('passBtn');
const textEl = document.getElementById('text');
const previews = document.getElementById('previews');
const counter = document.getElementById('counter');
const btnAlbum = document.getElementById('btnAlbum');
const btnCamera = document.getElementById('btnCamera');
const fileAlbum = document.getElementById('fileAlbum');
const fileCamera = document.getElementById('fileCamera');
const btnPublish = document.getElementById('btnPublish');
const listTitle = document.getElementById('listTitle');
const manageList = document.getElementById('manageList');

let picked = [];
let busy = false;

/* ---------- 口令 ---------- */
function showGate() {
  gate.hidden = false;
  composer.hidden = true;
  listTitle.hidden = true;
  manageList.textContent = '';
  passInput.value = '';
  passInput.focus();
}

function openComposer() {
  gate.hidden = true;
  composer.hidden = false;
  loadList();
}

async function tryPass(p) {
  await api('/api/verify', { pass: p });
}

async function unlock(p) {
  await tryPass(p);
  setPass(p);
  openComposer();
  toast('欢迎回来');
}

passBtn.addEventListener('click', () => {
  const p = passInput.value.trim();
  if (!p) return toast('请输入口令');
  unlock(p).catch(() => toast('口令错误'));
});
passInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passBtn.click();
});

async function handleAuthError(e) {
  if (e.status === 401) {
    setPass('');
    showGate();
    toast('口令失效，请重新输入');
  } else {
    toast(e.message);
  }
}

/* ---------- 压缩 ---------- */
function toBlob(canvas, q) {
  return new Promise((res, rej) => {
    canvas.toBlob((b) => {
      if (!b) return rej(new Error('编码失败'));
      if (b.type === 'image/webp') return res(b);
      canvas.toBlob((b2) => (b2 ? res(b2) : rej(new Error('编码失败'))), 'image/jpeg', q);
    }, 'image/webp', q);
  });
}

async function compress(file) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('不是图片');
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await createImageBitmap(file);
  }
  let w = bmp.width;
  let h = bmp.height;
  if (!w || !h) throw new Error('尺寸无效');
  const s0 = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.max(1, Math.round(w * s0));
  h = Math.max(1, Math.round(h * s0));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  for (;;) {
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);

    const lowest = await toBlob(canvas, Q_LO);
    if (lowest.size <= TARGET) {
      // 在体积边界内找最高质量（最清晰）
      let lo = Q_LO;
      let hi = Q_HI;
      let ans = lowest;
      while (hi - lo > 0.04) {
        const mid = (lo + hi) / 2;
        const b = await toBlob(canvas, mid);
        if (b.size <= TARGET) { ans = b; lo = mid; } else { hi = mid; }
      }
      bmp.close?.();
      return { blob: ans, w, h };
    }
    if (w < 500) {
      bmp.close?.();
      return { blob: lowest, w, h };
    }
    w = Math.round(w * SHRINK);
    h = Math.round(h * SHRINK);
  }
}

/* ---------- 选图 ---------- */
function setBusy(on, msg) {
  busy = on;
  btnAlbum.disabled = on;
  btnCamera.disabled = on;
  btnPublish.disabled = on;
  counter.classList.toggle('busy', on);
  if (on) counter.textContent = msg || '处理中…';
  else counter.textContent = `${picked.length}/${MAX_IMAGES}`;
}

async function addFiles(files) {
  if (!files.length) return;
  if (busy) return;
  const room = MAX_IMAGES - picked.length;
  if (room <= 0) return toast(`最多 ${MAX_IMAGES} 张`);
  if (files.length > room) toast(`最多 ${MAX_IMAGES} 张，多余的未添加`);
  const use = files.slice(0, room);

  let failed = 0;
  for (let i = 0; i < use.length; i++) {
    setBusy(true, `压缩 ${i + 1}/${use.length}…`);
    try {
      const r = await compress(use[i]);
      picked.push({ ...r, url: URL.createObjectURL(r.blob) });
      renderPreviews();
    } catch (e) {
      console.warn(e);
      failed++;
    }
  }
  setBusy(false);
  if (failed) toast(`${failed} 张图片无法处理`);
}

btnAlbum.addEventListener('click', () => fileAlbum.click());
btnCamera.addEventListener('click', () => fileCamera.click());
for (const input of [fileAlbum, fileCamera]) {
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    addFiles(files);
  });
}

function renderPreviews() {
  previews.textContent = '';
  picked.forEach((p, i) => {
    const cell = document.createElement('div');
    cell.className = 'pv';
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = '';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      URL.revokeObjectURL(picked[i].url);
      picked.splice(i, 1);
      renderPreviews();
    });
    cell.append(img, rm);
    previews.append(cell);
  });
  if (!busy) counter.textContent = `${picked.length}/${MAX_IMAGES}`;
}

function clearPicked() {
  for (const p of picked) URL.revokeObjectURL(p.url);
  picked = [];
  renderPreviews();
}

/* ---------- 发布 ---------- */
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

function xhrUpload(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('content-type', 'application/json');
    x.setRequestHeader('x-pass', getPass());
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) return resolve(d);
      const err = new Error(d.error || `发布失败 (${x.status})`);
      err.status = x.status;
      reject(err);
    };
    x.onerror = () => reject(new Error('网络错误'));
    x.send(JSON.stringify(body));
  });
}

btnPublish.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text && !picked.length) return toast('先写点什么或加几张图');
  btnPublish.disabled = true;
  const label = btnPublish.textContent;
  try {
    const images = [];
    for (const p of picked) {
      images.push({ data: await blobToBase64(p.blob), w: p.w, h: p.h });
    }
    await xhrUpload('/api/posts', { text, images }, (pct) => {
      btnPublish.textContent = `上传 ${pct}%`;
    });
    toast('已发布');
    textEl.value = '';
    clearPicked();
    loadList();
  } catch (e) {
    handleAuthError(e);
  } finally {
    btnPublish.disabled = busy;
    btnPublish.textContent = label;
  }
});

/* ---------- 管理列表 ---------- */
async function loadList() {
  try {
    const d = await api('/api/posts');
    listTitle.hidden = !d.posts.length;
    manageList.textContent = '';
    for (const p of d.posts) manageList.append(manageRow(p));
  } catch (e) {
    toast(e.message);
  }
}

function manageRow(p) {
  const row = document.createElement('div');
  row.className = 'manage-item';

  const body = document.createElement('div');
  body.className = 'mi-body';

  const t = document.createElement('div');
  t.className = 'mi-text' + (p.text ? '' : ' ph');
  t.textContent = p.text || '（仅图片）';
  body.append(t);

  const meta = document.createElement('div');
  meta.className = 'mi-meta';
  const time = document.createElement('span');
  time.textContent = formatTime(p.created_at);
  const cnt = document.createElement('span');
  cnt.textContent = p.images.length ? `${p.images.length} 张图` : '';
  meta.append(time, cnt);
  body.append(meta);

  if (p.images.length) {
    const thumbs = document.createElement('div');
    thumbs.className = 'mi-thumbs';
    for (const im of p.images) {
      const img = document.createElement('img');
      img.src = im.url;
      img.alt = '';
      img.loading = 'lazy';
      thumbs.append(img);
    }
    body.append(thumbs);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'mi-del';
  del.textContent = '删除';
  del.addEventListener('click', async () => {
    if (!confirm('删除这条说说？图片会一并删除。')) return;
    del.disabled = true;
    try {
      await api(`/api/posts/${p.id}`, { method: 'DELETE', pass: getPass() });
      toast('已删除');
      loadList();
    } catch (e) {
      del.disabled = false;
      handleAuthError(e);
    }
  });

  row.append(body, del);
  return row;
}

/* ---------- 启动 ---------- */
(async () => {
  const p = getPass();
  if (p) {
    try {
      await tryPass(p);
      openComposer();
      return;
    } catch {
      setPass('');
    }
  }
  showGate();
})();
