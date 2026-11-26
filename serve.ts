// A tiny static file server for game/ on port 8080, for local play and screenshot capture.
// Node 22+, standard library only, erasable TypeScript (runs as `node serve.ts`).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8080);
const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'game');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** The absolute file a request path names inside game/, or null when it would leave game/. */
function fileForRequest(rawUrl: string): string | null {
  const pathOnly = rawUrl.split(/[?#]/)[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const absolute = resolve(gameRoot, relative);
  if (absolute !== gameRoot && !absolute.startsWith(gameRoot + sep)) return null;
  return absolute;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  let file = fileForRequest(req.url ?? '/');
  if (file === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${gameRoot} on localhost:${PORT} (Ctrl+C to stop)`);
});
