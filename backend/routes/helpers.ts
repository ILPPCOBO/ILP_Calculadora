/**
 * helpers.ts — utilidades compartidas por los handlers de rutas.
 *
 * Los handlers son funciones puras de orquestación: reciben un contexto
 * `RouteContext` (con el body ya parseado, los parámetros de ruta y la query)
 * y devuelven un `RouteResult` (status + payload JSON). NO escriben en el socket
 * directamente; de eso se encarga el servidor. Así se mantienen testeables y sin
 * lógica de transporte.
 *
 * No reimplementan lógica de negocio: invocan los servicios y repositorios.
 */

import type { IncomingMessage } from 'node:http';

/** Resultado uniforme de un handler: código de estado + cuerpo JSON serializable. */
export interface RouteResult {
  status: number;
  body: unknown;
}

/** Contexto que el servidor pasa a cada handler. */
export interface RouteContext {
  /** Método HTTP en mayúsculas (GET, POST, PUT, ...). */
  method: string;
  /** Segmentos de la URL tras /api, ya decodificados. P.ej. ['documents', 'doc_1', 'extract-records']. */
  segments: string[];
  /** Parámetros de query (?status=...). */
  query: URLSearchParams;
  /** Cuerpo JSON ya parseado (o null si no había / no era JSON válido). */
  body: unknown;
  /** Mensaje crudo por si algún handler necesita cabeceras. */
  req: IncomingMessage;
}

/** Atajo para construir respuestas JSON. */
export function json(status: number, body: unknown): RouteResult {
  return { status, body };
}

/** Respuesta 200 OK con cuerpo. */
export function ok(body: unknown): RouteResult {
  return { status: 200, body };
}

/** Respuesta 201 Created con cuerpo. */
export function created(body: unknown): RouteResult {
  return { status: 201, body };
}

/** Respuesta de error con {error} y código dado. */
export function fail(status: number, message: string, extra?: Record<string, unknown>): RouteResult {
  return { status, body: { error: message, ...(extra ?? {}) } };
}

/** 400 Bad Request. */
export function badRequest(message: string, extra?: Record<string, unknown>): RouteResult {
  return fail(400, message, extra);
}

/** 404 Not Found. */
export function notFound(message = 'Recurso no encontrado.'): RouteResult {
  return fail(404, message);
}

/** Lee el body como objeto plano; si no es un objeto, devuelve {}. */
export function asObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

/** Extrae un string de un campo, o null si ausente/no-string. */
export function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}
