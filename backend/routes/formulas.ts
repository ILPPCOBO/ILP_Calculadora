/**
 * Rutas /api/formulas y /api/approved-formulas — generación y revisión (R6, R13).
 *
 * Orquesta formulaGenerator y formulaReview. NO reimplementa lógica:
 *  - POST /api/formulas/generate        -> generateAndSaveFormula (nace pending_review)
 *  - GET  /api/formulas?status=         -> listByStatus / list all
 *  - PUT  /api/formulas/:id             -> updateFormula (patch)
 *  - POST /api/formulas/:id/approve     -> approveFormula {approved_by} (copia a approved)
 *  - POST /api/formulas/:id/reject      -> rejectFormula {rejected_reason, by}
 *  - GET  /api/approved-formulas        -> approvedFormulasRepo.list()
 */

import { generateAndSaveFormula } from '../../services/formulaGenerator.ts';
import {
  listByStatus, updateFormula, approveFormula, rejectFormula, canApprove,
} from '../../services/formulaReview.ts';
import { formulasRepo, approvedFormulasRepo } from '../storage/index.ts';
import { REVIEW_STATUS_VALUES, FORMULA_TYPE_VALUES } from '../models/index.ts';
import type { PricingFormula, ReviewStatus, FormulaType } from '../models/index.ts';
import {
  ok, created, badRequest, notFound, fail, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

/** Maneja GET /api/approved-formulas. */
export async function handleApprovedFormulas(_ctx: RouteContext): Promise<RouteResult> {
  return ok(approvedFormulasRepo.list().filter((f) => f.review_status === 'approved'));
}

export async function handleFormulas(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, query, body } = ctx;
  const first = segments[1]; // ':id' o 'generate'
  const action = segments[2]; // 'approve' | 'reject'

  // ---- POST /api/formulas/generate ----
  if (method === 'POST' && first === 'generate') {
    const o = asObject(body);
    const category = str(o, 'service_category') ?? str(o, 'category');
    if (!category || category.trim() === '') {
      return badRequest('Falta "service_category" para generar la fórmula.');
    }
    const subRaw = str(o, 'service_subcategory') ?? str(o, 'subcategory');
    const typeRaw = str(o, 'formula_type');
    const formulaType = typeRaw && (FORMULA_TYPE_VALUES as string[]).includes(typeRaw)
      ? (typeRaw as FormulaType)
      : undefined;
    const createdBy = str(o, 'created_by') ?? str(o, 'createdBy') ?? undefined;

    const formula = generateAndSaveFormula({
      service_category: category.trim(),
      service_subcategory: subRaw,
      formula_type: formulaType,
      created_by: createdBy,
    });
    return created(formula);
  }

  // ---- GET /api/formulas?status= ----
  if (method === 'GET' && !first) {
    const status = query.get('status');
    if (status && (REVIEW_STATUS_VALUES as string[]).includes(status)) {
      return ok(listByStatus(status as ReviewStatus));
    }
    if (status) {
      return badRequest(`Estado "${status}" inválido. Use: ${REVIEW_STATUS_VALUES.join(', ')}.`);
    }
    return ok(formulasRepo.list());
  }

  const id = first;

  // ---- PUT /api/formulas/:id ----
  if (method === 'PUT' && id && !action) {
    const patch = asObject(body) as Partial<PricingFormula>;
    const updated = updateFormula(id, patch);
    if (!updated) return notFound(`Fórmula "${id}" no encontrada.`);
    return ok(updated);
  }

  // ---- POST /api/formulas/:id/approve ----
  if (method === 'POST' && id && action === 'approve') {
    const o = asObject(body);
    const approvedBy = str(o, 'approved_by') ?? str(o, 'approvedBy');
    if (!approvedBy) return badRequest('Falta "approved_by" (R7: sólo un usuario interno aprueba).');
    const result = approveFormula(id, approvedBy);
    if (!result.ok) {
      if (result.missing && result.missing.includes('formula_not_found')) {
        return notFound(`Fórmula "${id}" no encontrada.`);
      }
      // R13: faltan campos para aprobar -> 422 con el detalle.
      return fail(422, 'La fórmula no cumple los requisitos para aprobarse.', { missing: result.missing });
    }
    return ok(result.formula);
  }

  // ---- POST /api/formulas/:id/reject ----
  if (method === 'POST' && id && action === 'reject') {
    const o = asObject(body);
    const reason = str(o, 'rejected_reason') ?? str(o, 'rejectedReason') ?? '';
    const by = str(o, 'by') ?? str(o, 'rejected_by') ?? 'desconocido';
    const updated = rejectFormula(id, reason, by);
    if (!updated) return notFound(`Fórmula "${id}" no encontrada.`);
    return ok(updated);
  }

  // ---- GET /api/formulas/:id/can-approve (extra de utilidad, no rompe contrato) ----
  if (method === 'GET' && id && action === 'can-approve') {
    const f = formulasRepo.get(id);
    if (!f) return notFound(`Fórmula "${id}" no encontrada.`);
    return ok(canApprove(f));
  }

  return badRequest('Operación de fórmulas no soportada.');
}
