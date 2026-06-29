/**
 * Ruta /api/import — importación masiva de acuerdos desde una carpeta del servidor.
 *
 *  - POST /api/import  body: { dir, documentType?, extractRecords?, recursive?, limit? }
 *
 * Pensada para uso interno/local: el servidor lee una carpeta de la propia máquina
 * (donde están los documentos históricos) y los procesa. Para cargas puntuales desde
 * el navegador se usa POST /api/documents (multi-archivo). Orquesta batchImport.
 *
 * Nota: con cientos de archivos esta llamada puede tardar; el CLI `admin/import.ts`
 * es la vía recomendada para lotes muy grandes (da progreso por archivo).
 */

import { importFromDirectory } from '../../services/batchImport.ts';
import { DOCUMENT_TYPE_VALUES } from '../models/index.ts';
import type { DocumentType } from '../models/index.ts';
import {
  ok, badRequest, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

export async function handleImport(ctx: RouteContext): Promise<RouteResult> {
  if (ctx.method !== 'POST') return badRequest('Use POST en /api/import con { dir }.');

  const o = asObject(ctx.body);
  const dir = str(o, 'dir');
  if (!dir || dir.trim() === '') {
    return badRequest('Falta "dir": ruta absoluta de la carpeta a importar.');
  }

  const docTypeRaw = str(o, 'documentType');
  const documentType = docTypeRaw && (DOCUMENT_TYPE_VALUES as string[]).includes(docTypeRaw)
    ? (docTypeRaw as DocumentType)
    : undefined;

  const extractRecords = typeof o.extractRecords === 'boolean' ? o.extractRecords : true;
  const recursive = typeof o.recursive === 'boolean' ? o.recursive : true;
  const limit = typeof o.limit === 'number' && Number.isFinite(o.limit) ? o.limit : undefined;

  const result = await importFromDirectory({
    dir: dir.trim(),
    uploadedBy: str(o, 'uploadedBy') ?? 'import_api',
    documentType,
    extractRecords,
    recursive,
    limit,
  });

  return ok(result);
}
