export const PASS_KEY = 'hometown-pass';

export function getPass() {
  return localStorage.getItem(PASS_KEY) || '';
}

export function setPass(p) {
  if (p) localStorage.setItem(PASS_KEY, p);
  else localStorage.removeItem(PASS_KEY);
}

export async function api(pathname, { method = 'GET', body, pass } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (pass) headers['x-pass'] = pass;
  const res = await fetch(pathname, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function formatTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  const d = new Date(ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  const dayStr = (t) => new Date(t).toDateString();
  if (dayStr(now - 86_400_000) === dayStr(ts)) return '昨天';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
