/**
 * server.ts — servidor HTTP sin dependencias (node:http) de la Calculadora.
 *
 * Responsabilidades (sólo transporte; la lógica vive en services/ y routes/):
 *  - Sirve /frontend como estático (index.html en "/", /app.js, /pages/*, /assets/*).
 *  - Enruta /api/* a los handlers de dominio (backend/routes) que orquestan los
 *    servicios y repositorios. NUNCA reimplementa lógica de negocio.
 *  - Lee el body JSON de las peticiones con cuerpo.
 *  - CORS básico permitido (uso interno).
 *  - Responde 404 y errores con JSON {error} y códigos de estado correctos.
 *
 * Restricciones de TS strip-only respetadas: sin enum, sin parameter properties,
 * imports locales con extensión .ts, `import type` para tipos, ESM puro.
 *
 * Si se ejecuta directamente (import.meta.url === main) arranca en
 * process.env.PORT || 3000 e imprime la URL.
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

import { dispatch } from './routes/index.ts';
import type { RouteContext, RouteResult } from './routes/helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** backend/ -> raíz del proyecto. */
const PROJECT_ROOT = join(__dirname, '..');
const FRONTEND_DIR = join(PROJECT_ROOT, 'frontend');

/** Tamaño máximo de body aceptado (5 MB para subidas en base64 modestas). */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Escribe una respuesta JSON con CORS. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(payload);
}

/** Lee el cuerpo completo de la petición y lo parsea como JSON (o null). */
function readJsonBody(req: IncomingMessage): Promise<{ body: unknown; error: string | null }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        resolve({ body: null, error: 'Cuerpo de la petición demasiado grande.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        resolve({ body: null, error: null });
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({ body: null, error: null });
        return;
      }
      try {
        resolve({ body: JSON.parse(raw), error: null });
      } catch {
        resolve({ body: null, error: 'JSON inválido en el cuerpo de la petición.' });
      }
    });

    req.on('error', () => {
      if (aborted) return;
      resolve({ body: null, error: 'Error leyendo el cuerpo de la petición.' });
    });
  });
}

/**
 * Resuelve y sirve un archivo estático del frontend de forma segura
 * (sin path traversal). Devuelve true si lo sirvió, false si no existe.
 */
async function serveStatic(urlPath: string, res: ServerResponse): Promise<boolean> {
  // Normaliza y evita que la ruta escape de FRONTEND_DIR.
  const decoded = decodeURIComponent(urlPath);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = normalize(join(FRONTEND_DIR, rel));
  if (!candidate.startsWith(FRONTEND_DIR)) {
    return false; // intento de salir del directorio servido
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      // Servir index.html dentro del directorio si existe.
      const indexFile = join(candidate, 'index.html');
      const data = await readFile(indexFile);
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-cache', ...CORS_HEADERS });
      res.end(data);
      return true;
    }
    const data = await readFile(candidate);
    const mime = MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream';
    // Sin caché: la herramienta es interna y evoluciona; que el navegador siempre revalide.
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', ...CORS_HEADERS });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/** Maneja una petición a /api/*: parsea body, despacha y responde JSON. */
async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  query: URLSearchParams,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();

  let body: unknown = null;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    body = parsed.body;
  }

  const ctx: RouteContext = { method, segments, query, body, req };

  let result: RouteResult;
  try {
    result = await dispatch(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor.';
    sendJson(res, 500, { error: message });
    return;
  }
  sendJson(res, result.status, result.body);
}

/** Manejador principal de cada petición. */
async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();

  // Preflight CORS.
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // URL absoluta ficticia sólo para parsear ruta + query con la API URL.
  const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = parsedUrl.pathname;

  // ---- API ----
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const segments = pathname
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s));
    await handleApi(req, res, segments, parsedUrl.searchParams);
    return;
  }

  // ---- Estático (sólo GET/HEAD) ----
  if (method === 'GET' || method === 'HEAD') {
    const served = await serveStatic(pathname, res);
    if (served) return;
    // Fallback SPA: rutas desconocidas (que no sean assets) sirven index.html.
    if (!extname(pathname)) {
      const fallback = await serveStatic('/', res);
      if (fallback) return;
    }
    sendJson(res, 404, { error: `Recurso "${pathname}" no encontrado.` });
    return;
  }

  sendJson(res, 405, { error: `Método ${method} no permitido en "${pathname}".` });
}

/** Crea el servidor HTTP (sin arrancarlo). */
export function createServer(): http.Server {
  return http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : 'Error interno del servidor.';
      try {
        sendJson(res, 500, { error: message });
      } catch {
        // La respuesta ya pudo cerrarse; nada más que hacer.
      }
    });
  });
}

/** Crea y arranca el servidor en el puerto dado (por defecto 3000). */
export function startServer(port: number | string = 3000): http.Server {
  const server = createServer();
  const p = typeof port === 'string' ? parseInt(port, 10) || 3000 : port;
  server.listen(p, () => {
    // eslint-disable-next-line no-console
    console.log(`Calculadora Inteligente de Honorarios escuchando en http://localhost:${p}`);
  });
  return server;
}

// Arranque directo: node backend/server.ts
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  startServer(process.env.PORT ?? 3000);
}
