/**
 * Rutas /api/records — revisión humana de registros extraídos (R4, R7, R15).
 *
 * Orquesta recordReview. NO reimplementa lógica:
 *  - GET   /api/records?status=        -> listByStatus / list all
 *  - PUT   /api/records/:id             -> updateRecord (patch)
 *  - POST  /api/records/:id/approve     -> approveRecord {approved_by}
 *  - POST  /api/records/:id/reject      -> rejectRecord {rejected_reason, by}
 */

import {
  listByStatus, updateRecord, approveRecord, rejectRecord, approveBatch,
} from '../../services/recordReview.ts';
import { recordsRepo } from '../storage/index.ts';
import { REVIEW_STATUS_VALUES } from '../models/index.ts';
import type { ExtractedWorkRecord, ReviewStatus } from '../models/index.ts';
import {
  ok, badRequest, notFound, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

export async function handleRecords(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, query, body } = ctx;
  const id = segments[1];
  const action = segments[2];

  // ---- GET /api/records?status= ----
  if (method === 'GET' && !id) {
    const status = query.get('status');
    if (status && (REVIEW_STATUS_VALUES as string[]).includes(status)) {
      return ok(listByStatus(status as ReviewStatus));
    }
    if (status) {
      return badRequest(`Estado "${status}" inválido. Use: ${REVIEW_STATUS_VALUES.join(', ')}.`);
    }
    return ok(recordsRepo.list());
  }

  // ---- POST /api/records/approve-batch {by, service_category?} ----
  if (method === 'POST' && id === 'approve-batch' && !action) {
    const o = asObject(body);
    const by = str(o, 'by') ?? str(o, 'approved_by') ?? 'usuario_interno';
    const cat = str(o, 'service_category');
    const res = approveBatch(by, cat);
    return ok(res);
  }

  // ---- PUT /api/records/:id ----
  if (method === 'PUT' && id && !action) {
    const patch = asObject(body) as Partial<ExtractedWorkRecord>;
    const updated = updateRecord(id, patch);
    if (!updated) return notFound(`Registro "${id}" no encontrado.`);
    return ok(updated);
  }

  // ---- POST /api/records/:id/approve ----
  if (method === 'POST' && id && action === 'approve') {
    const o = asObject(body);
    const approvedBy = str(o, 'approved_by') ?? str(o, 'approvedBy');
    if (!approvedBy) return badRequest('Falta "approved_by" (R7: sólo un usuario interno aprueba).');
    const updated = approveRecord(id, approvedBy);
    if (!updated) return notFound(`Registro "${id}" no encontrado.`);
    return ok(updated);
  }

  // ---- POST /api/records/:id/reject ----
  if (method === 'POST' && id && action === 'reject') {
    const o = asObject(body);
    const reason = str(o, 'rejected_reason') ?? str(o, 'rejectedReason') ?? '';
    const by = str(o, 'by') ?? str(o, 'rejected_by') ?? 'desconocido';
    const updated = rejectRecord(id, reason, by);
    if (!updated) return notFound(`Registro "${id}" no encontrado.`);
    return ok(updated);
  }

  return badRequest('Operación de registros no soportada.');
}
