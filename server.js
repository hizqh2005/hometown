import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = 'hizqh';
const MAX_BODY = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'moments.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    file TEXT NOT NULL,
    w INTEGER NOT NULL,
    h INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_images_post ON images(post_id);
`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const STATIC_EXT = new Set(Object.keys(MIME));

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

function passOk(req) {
  const got = req.headers['x-pass'];
  if (typeof got !== 'string') return false;
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 'E_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sniffImage(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  return null;
}

function apiPosts(res) {
  const posts = db.prepare('SELECT id, text, created_at FROM posts ORDER BY created_at DESC, id DESC').all();
  const imgStmt = db.prepare('SELECT file, w, h FROM images WHERE post_id = ? ORDER BY seq');
  for (const p of posts) {
    p.images = imgStmt.all(p.id).map((r) => ({ url: '/uploads/' + r.file, w: r.w, h: r.h }));
  }
  json(res, 200, { posts });
}

async function createPost(req, res) {
  if (!passOk(req)) return json(res, 401, { error: '口令错误' });
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    if (e.code === 'E_TOO_LARGE') return json(res, 413, { error: '内容过大' });
    return json(res, 400, { error: '请求格式错误' });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > 2000) return json(res, 400, { error: '文字最多 2000 字' });
  const list = Array.isArray(body.images) ? body.images.slice(0, 9) : [];
  if (!text && !list.length) return json(res, 400, { error: '先写点什么或加几张图' });

  const decoded = [];
  for (const item of list) {
    if (!item || typeof item.data !== 'string') return json(res, 400, { error: '图片数据无效' });
    const b64 = item.data.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return json(res, 400, { error: '单张图片超过 3MB' });
    const ext = sniffImage(buf);
    if (!ext) return json(res, 400, { error: '图片格式不支持' });
    decoded.push({ buf, ext, w: Math.max(1, Math.round(Number(item.w) || 1)), h: Math.max(1, Math.round(Number(item.h) || 1)) });
  }

  const files = [];
  try {
    for (const d of decoded) {
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${d.ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), d.buf);
      files.push(name);
    }
    db.exec('BEGIN');
    const info = db.prepare('INSERT INTO posts (text, created_at) VALUES (?, ?)').run(text, Date.now());
    const postId = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO images (post_id, seq, file, w, h) VALUES (?, ?, ?, ?, ?)');
    files.forEach((name, i) => ins.run(postId, i, name, decoded[i].w, decoded[i].h));
    db.exec('COMMIT');
    json(res, 200, { id: postId });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    for (const f of files) fs.promises.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
    throw e;
  }
}

async function deletePost(req, res, id) {
  if (!passOk(req)) return json(res, 401, { error: '口令错误' });
  if (!Number.isInteger(id)) return json(res, 400, { error: 'id 无效' });
  const rows = db.prepare('SELECT file FROM images WHERE post_id = ?').all(id);
  if (!rows.length && !db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) {
    return json(res, 404, { error: '说说不存在' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  for (const r of rows) fs.promises.unlink(path.join(UPLOAD_DIR, r.file)).catch(() => {});
  json(res, 200, { ok: true });
}

function serveUpload(res, file) {
  if (!/^[\w.-]+\.(webp|jpe?g|png)$/i.test(file)) return json(res, 404, { error: 'not found' });
  const fp = path.join(UPLOAD_DIR, file);
  fs.readFile(fp, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': buf.length,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(buf);
  });
}

function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  const ext = path.extname(fp).toLowerCase();
  if (!STATIC_EXT.has(ext)) return json(res, 404, { error: 'not found' });
  fs.readFile(fp, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[ext],
      'content-length': buf.length,
      'cache-control': ext === '.html' || ext === '.css' || ext === '.js' ? 'no-cache' : 'public, max-age=600',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/posts') return apiPosts(res);
    if (req.method === 'GET' && p === '/api/verify') {
      const ok = passOk(req);
      return json(res, ok ? 200 : 401, ok ? { ok: true } : { error: '口令错误' });
    }
    if (req.method === 'POST' && p === '/api/posts') return await createPost(req, res);
    if (req.method === 'DELETE' && p.startsWith('/api/posts/')) {
      return await deletePost(req, res, Number(p.slice('/api/posts/'.length)));
    }
    if (req.method === 'GET' && p.startsWith('/uploads/')) return serveUpload(res, path.basename(p));
    if (req.method === 'GET') return serveStatic(req, res, p);
    json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: '服务器错误' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`朋友圈已启动:`);
  console.log(`  本机   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  手机   http://${ip}:${PORT}   (同一 Wi-Fi)`);
});
