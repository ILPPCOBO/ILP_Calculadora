/**
 * Rutas /api/documents — subida, listado, detalle y extracción de registros.
 *
 * Orquesta documentUploadService y workRecordExtractor. NO reimplementa lógica:
 *  - POST  /api/documents                      -> uploadDocument (base64 -> Buffer)
 *  - GET   /api/documents                       -> listDocuments
 *  - GET   /api/documents/:id                    -> getDocument
 *  - POST  /api/documents/:id/extract-records    -> extractAndSaveRecords
 *
 * R5/R12: los registros extraídos nacen en pending_review (lo garantiza el
 * servicio). Aquí sólo se orquesta y se devuelven códigos de estado correctos.
 */

import {
  uploadDocument, listDocuments, getDocument, deleteDocument,
} from '../../services/documentUploadService.ts';
import { extractAndSaveRecords } from '../../services/workRecordExtractor.ts';
import { DOCUMENT_TYPE_VALUES } from '../models/index.ts';
import type { DocumentType } from '../models/index.ts';
import {
  ok, created, badRequest, notFound, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function normalizeDocumentType(value: string | null): DocumentType {
  if (value && (DOCUMENT_TYPE_VALUES as string[]).includes(value)) {
    return value as DocumentType;
  }
  return 'other';
}

export async function handleDocuments(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, body } = ctx;
  // segments[0] === 'documents'
  const id = segments[1];
  const action = segments[2];

  // ---- POST /api/documents ----
  if (method === 'POST' && !id) {
    const o = asObject(body);
    const filename = str(o, 'filename');
    const fileType = str(o, 'fileType') ?? str(o, 'file_type');
    const contentBase64 = str(o, 'contentBase64') ?? str(o, 'content_base64');
    const uploadedBy = str(o, 'uploadedBy') ?? str(o, 'uploaded_by') ?? 'desconocido';

    if (!filename) return badRequest('Falta "filename".');
    if (!fileType) return badRequest('Falta "fileType".');
    if (!contentBase64) return badRequest('Falta "contentBase64" (binario en base64).');

    let buffer: Buffer;
    try {
      buffer = Buffer.from(contentBase64, 'base64');
    } catch {
      return badRequest('"contentBase64" no es base64 válido.');
    }

    const documentType = normalizeDocumentType(
      str(o, 'documentType') ?? str(o, 'document_type'),
    );

    const doc = await uploadDocument({
      filename,
      fileType,
      documentType,
      uploadedBy,
      content: buffer,
    });
    return created(doc);
  }

  // ---- GET /api/documents ----
  if (method === 'GET' && !id) {
    return ok(listDocuments());
  }

  // ---- GET /api/documents/:id ----
  if (method === 'GET' && id && !action) {
    const doc = getDocument(id);
    if (!doc) return notFound(`Documento "${id}" no encontrado.`);
    return ok(doc);
  }

  // ---- POST /api/documents/:id/extract-records ----
  if (method === 'POST' && id && action === 'extract-records') {
    const doc = getDocument(id);
    if (!doc) return notFound(`Documento "${id}" no encontrado.`);
    const records = await extractAndSaveRecords(doc);
    return created({ document_id: id, count: records.length, records });
  }

  // ---- DELETE /api/documents/:id[?force=true] ----
  if (method === 'DELETE' && id && !action) {
    const force = ctx.query.get('force') === 'true'
      || (asObject(body).force === true);
    const result = deleteDocument(id, { force });
    if (result === null) return notFound(`Documento "${id}" no encontrado.`);
    // Si está bloqueado por registros aprobados, devolvemos 409 (conflicto) con el detalle.
    if (result.blocked) return { status: 409, body: result };
    return ok(result);
  }

  return badRequest('Operación de documentos no soportada.');
}
