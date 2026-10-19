import { formatTime, toast, api } from './common.js';

const feed = document.getElementById('feed');
const rail = document.getElementById('rail');
const indicator = document.getElementById('railIndicator');
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lbImg');
const lbCount = document.getElementById('lbCount');

let posts = [];
let sections = [];
let scrubbing = false;
let scrubYear = null;

async function load() {
  try {
    const d = await api('/api/posts');
    posts = d.posts;
    render();
    spy();
  } catch (e) {
    feed.textContent = '';
    const box = document.createElement('div');
    box.className = 'empty';
    box.textContent = `加载失败：${e.message}`;
    const btn = document.createElement('a');
    btn.href = '#';
    btn.textContent = '重试';
    btn.addEventListener('click', (ev) => { ev.preventDefault(); load(); });
    box.append(document.createElement('br'), btn);
    feed.append(box);
  }
}

function render() {
  feed.textContent = '';
  sections = [];
  if (!posts.length) {
    const box = document.createElement('div');
    box.className = 'empty';
    box.textContent = '还没有说说';
    const a = document.createElement('a');
    a.href = 'editor.html';
    a.textContent = '去发布一条 →';
    box.append(document.createElement('br'), a);
    feed.append(box);
    rail.hidden = true;
    return;
  }

  let sec = null;
  let curYear = null;
  posts.forEach((p, pi) => {
    const year = String(new Date(p.created_at).getFullYear());
    if (year !== curYear) {
      curYear = year;
      sec = document.createElement('section');
      sec.id = 'y' + year;
      const hd = document.createElement('div');
      hd.className = 'year-hd';
      hd.textContent = year;
      sec.append(hd);
      feed.append(sec);
      sections.push({ year, el: sec });
    }
    sec.append(card(p, pi));
  });
  buildRail();
}

function card(p, pi) {
  const art = document.createElement('article');
  art.className = 'card';

  const hd = document.createElement('div');
  hd.className = 'card-hd';
  const av = document.createElement('div');
  av.className = 'avatar';
  av.textContent = '🌄';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = '我';
  const time = document.createElement('div');
  time.className = 'card-time';
  time.textContent = formatTime(p.created_at);
  meta.append(name, time);
  hd.append(av, meta);
  art.append(hd);

  if (p.text) {
    const t = document.createElement('p');
    t.className = 'card-text';
    t.textContent = p.text;
    art.append(t);
  }

  if (p.images.length) {
    const n = p.images.length;
    const g = document.createElement('div');
    g.className = 'grid n' + n;
    const cap = Math.min(230, window.innerWidth * 0.62);
    p.images.forEach((im, ii) => {
      const img = document.createElement('img');
      img.src = im.url;
      img.alt = '';
      img.loading = 'lazy';
      if (n === 1) {
        const s = Math.min(cap / im.w, cap / im.h, 1);
        img.style.width = Math.round(im.w * s) + 'px';
        img.style.height = Math.round(im.h * s) + 'px';
      }
      img.addEventListener('click', () => openLightbox(pi, ii));
      g.append(img);
    });
    art.append(g);
  }
  return art;
}

/* ---------- year rail ---------- */
function buildRail() {
  rail.textContent = '';
  if (sections.length < 2) {
    rail.hidden = true;
    return;
  }
  for (const s of sections) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail-year';
    b.dataset.year = s.year;
    b.textContent = s.year;
    rail.append(b);
  }
  rail.hidden = false;
  highlight(sections[0].year);
}

function highlight(year) {
  for (const el of rail.children) {
    el.classList.toggle('active', el.dataset.year === year);
  }
}

function jumpTo(year) {
  const s = sections.find((x) => x.year === year);
  if (s) s.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function yearAtY(clientY) {
  let best = null;
  let bd = Infinity;
  for (const el of rail.children) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(clientY - (r.top + r.height / 2));
    if (d < bd) { bd = d; best = el; }
  }
  return best;
}

function scrubUpdate(clientY) {
  const el = yearAtY(clientY);
  if (!el || el.dataset.year === scrubYear) return;
  scrubYear = el.dataset.year;
  highlight(scrubYear);
  indicator.textContent = scrubYear;
  indicator.classList.add('show');
}

function scrubEnd() {
  if (!scrubYear) return;
  jumpTo(scrubYear);
  const y = scrubYear;
  scrubYear = null;
  setTimeout(() => {
    if (!scrubYear) indicator.classList.remove('show');
    spy();
    highlight(y);
  }, 520);
}

rail.addEventListener('touchstart', (e) => {
  e.preventDefault();
  scrubbing = true;
  scrubUpdate(e.touches[0].clientY);
}, { passive: false });
rail.addEventListener('touchmove', (e) => {
  if (!scrubbing) return;
  e.preventDefault();
  scrubUpdate(e.touches[0].clientY);
}, { passive: false });
rail.addEventListener('touchend', () => {
  scrubbing = false;
  scrubEnd();
});
rail.addEventListener('mousedown', (e) => {
  e.preventDefault();
  scrubbing = true;
  scrubUpdate(e.clientY);
});
window.addEventListener('mousemove', (e) => {
  if (scrubbing) scrubUpdate(e.clientY);
});
window.addEventListener('mouseup', () => {
  if (!scrubbing) return;
  scrubbing = false;
  scrubEnd();
});
rail.addEventListener('click', (e) => {
  const b = e.target.closest('.rail-year');
  if (b) jumpTo(b.dataset.year);
});

function spy() {
  if (!sections.length) return;
  const y = window.scrollY + 100;
  let cur = sections[0].year;
  for (const s of sections) {
    if (s.el.getBoundingClientRect().top + window.scrollY <= y) cur = s.year;
  }
  if (!scrubbing) highlight(cur);
}

let raf = 0;
window.addEventListener('scroll', () => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; spy(); });
}, { passive: true });

/* ---------- lightbox ---------- */
let lbPi = -1;
let lbIi = 0;
let swipe = null;
let swipeMoved = false;

function openLightbox(pi, ii) {
  lbPi = pi;
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => lightbox.classList.add('show'));
  showLb(ii);
}

function showLb(ii) {
  const imgs = posts[lbPi].images;
  lbIi = ((ii % imgs.length) + imgs.length) % imgs.length;
  lbImg.src = imgs[lbIi].url;
  lbCount.textContent = `${lbIi + 1}/${imgs.length}`;
}

function closeLightbox() {
  lightbox.classList.remove('show');
  document.body.style.overflow = '';
  setTimeout(() => { lightbox.hidden = true; }, 200);
}

document.getElementById('lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox && !swipeMoved) closeLightbox();
});

lightbox.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY };
  swipeMoved = false;
}, { passive: true });
lightbox.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  swipeMoved = Math.abs(dx) > 12 || Math.abs(dy) > 12;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
    showLb(lbIi + (dx < 0 ? 1 : -1));
  }
  swipe = null;
}, { passive: true });

lightbox.addEventListener('mousedown', (e) => {
  swipe = { x: e.clientX, y: e.clientY };
  swipeMoved = false;
});
window.addEventListener('mouseup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  swipeMoved = Math.abs(dx) > 12 || Math.abs(dy) > 12;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
    showLb(lbIi + (dx < 0 ? 1 : -1));
  }
  swipe = null;
});

window.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') showLb(lbIi + 1);
  else if (e.key === 'ArrowLeft') showLb(lbIi - 1);
});

load();
