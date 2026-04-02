import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || '8080');
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || process.env.OPENCLAUDE_CONTROL_TOKEN || '';
const WORKSPACE_ROOT = path.resolve(process.env.OPENCLAUDE_WORKSPACE || '/workspace');
const MAX_READ_BYTES = Number(process.env.CONTROL_MAX_READ_BYTES || 256 * 1024);
const MAX_WRITE_BYTES = Number(process.env.CONTROL_MAX_WRITE_BYTES || 256 * 1024);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const headerToken = req.headers['x-control-token'];
  return typeof headerToken === 'string' ? headerToken.trim() : '';
}

function requireAuth(req, res) {
  if (!CONTROL_TOKEN) {
    sendJson(res, 500, { error: 'control_token_not_configured' });
    return false;
  }
  const token = getToken(req);
  if (!token || token !== CONTROL_TOKEN) {
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveWorkspacePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') throw new Error('path_required');
  const candidate = path.resolve(WORKSPACE_ROOT, inputPath.replace(/^\/+/, ''));
  const relative = path.relative(WORKSPACE_ROOT, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path_outside_workspace');
  return candidate;
}

async function handleRead(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  const filePath = resolveWorkspacePath(body.path);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return sendJson(res, 400, { error: 'not_a_file' });
  if (stat.size > MAX_READ_BYTES) return sendJson(res, 413, { error: 'file_too_large', maxBytes: MAX_READ_BYTES, size: stat.size });
  const content = await fs.readFile(filePath, 'utf8');
  return sendJson(res, 200, {
    path: path.relative(WORKSPACE_ROOT, filePath),
    size: stat.size,
    content,
  });
}

async function handleWrite(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content_required' });
  const bytes = Buffer.byteLength(body.content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) return sendJson(res, 413, { error: 'content_too_large', maxBytes: MAX_WRITE_BYTES, size: bytes });
  const filePath = resolveWorkspacePath(body.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body.content, 'utf8');
  return sendJson(res, 200, {
    ok: true,
    path: path.relative(WORKSPACE_ROOT, filePath),
    bytes,
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'openclaude-control',
        workspace: WORKSPACE_ROOT,
      });
    }

    if (!requireAuth(req, res)) return;

    if (url.pathname === '/read') return await handleRead(req, res);
    if (url.pathname === '/write') return await handleWrite(req, res);

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    const status = ['path_required', 'path_outside_workspace'].includes(message) ? 400 : 500;
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`openclaude control server listening on ${HOST}:${PORT}`);
});
