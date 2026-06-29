/** Utilidades de identificadores y fechas. */
import { randomUUID } from 'node:crypto';

/** ID con prefijo legible por tipo de entidad, p.ej. "doc_1a2b...", "rec_...". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

/** Marca de tiempo ISO 8601 actual. */
export function nowIso(): string {
  return new Date().toISOString();
}
