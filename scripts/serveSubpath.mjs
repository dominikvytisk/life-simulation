/**
 * Minimal static server that mounts ./dist under a subpath, the way GitHub
 * Pages serves a project site. Used to verify that a build made with
 * BASE_PATH=/<repo>/ actually resolves all of its assets — including the worker
 * chunks, whose URLs are baked in at build time and are the thing most likely
 * to break on a subpath deployment.
 *
 *   node scripts/serveSubpath.mjs /life/ 4177
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const mount = process.argv[2] || '/life/';
const port = Number(process.argv[3] || 4177);
const root = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!url.startsWith(mount)) {
    // Exactly what Pages does outside the project path.
    res.writeHead(404).end('not found (outside mount)');
    return;
  }
  let rel = url.slice(mount.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(port, () => {
  console.log(`serving dist at http://localhost:${port}${mount}`);
});
