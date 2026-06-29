/**
 * Rutas /api/breakdowns — "Desglose de actuaciones previstas".
 *
 *  POST   /api/breakdowns                  -> crear desde estimación o cálculo
 *  GET    /api/breakdowns                  -> listar (?calculation_id= filtra)
 *  GET    /api/breakdowns/:id              -> detalle
 *  PUT    /api/breakdowns/:id              -> editar (actuaciones, valoración, horas…)
 *  DELETE /api/breakdowns/:id              -> eliminar
 *  POST   /api/breakdowns/:id/export-word  -> genera .docx (base64 en JSON)
 *
 * Orquesta los servicios; no reimplementa lógica de negocio.
 */

import {
  createBreakdown, getBreakdown, listBreakdowns, updateBreakdown, deleteBreakdown,
  findBreakdownsByCalculation,
} from '../../services/plannedActionsBreakdown.ts';
import type { BreakdownInput } from '../../services/plannedActionsBreakdown.ts';
import { saveBreakdownDocx } from '../../services/wordBreakdownExporter.ts';
import { COMPLEXITY_LEVEL_VALUES, URGENCY_LEVEL_VALUES, BREAKDOWN_SOURCE_TYPE_VALUES } from '../models/index.ts';
import type { ComplexityLevel, UrgencyLevel, BreakdownSourceType, PlannedActionBreakdown } from '../models/index.ts';
import {
  ok, created, badRequest, notFound, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === 'string').map((x) => (x as string));
}

export async function handleBreakdowns(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, query, body } = ctx;
  const id = segments[1];
  const action = segments[2];

  // ---- POST /api/breakdowns ----
  if (method === 'POST' && !id) {
    const o = asObject(body);
    const category = str(o, 'service_category');
    if (!category || category.trim() === '') {
      return badRequest('Falta "service_category" para generar el desglose.');
    }
    const sourceRaw = str(o, 'source_type') ?? 'automatic_estimate';
    const source_type: BreakdownSourceType = (BREAKDOWN_SOURCE_TYPE_VALUES as string[]).includes(sourceRaw)
      ? (sourceRaw as BreakdownSourceType) : 'automatic_estimate';

    const complexityRaw = str(o, 'complexity_level') ?? str(o, 'complexity');
    const urgencyRaw = str(o, 'urgency_level') ?? str(o, 'urgency');

    const input: BreakdownInput = {
      case_or_calculation_id: str(o, 'case_or_calculation_id') ?? str(o, 'calculation_id'),
      source_type,
      description: str(o, 'description'),
      service_category: category.trim(),
      service_subcategory: str(o, 'service_subcategory'),
      tasks: strArray(o.tasks),
      estimated_total_hours: numOrNull(o.estimated_total_hours),
      estimated_total_fee: numOrNull(o.estimated_total_fee),
      currency: str(o, 'currency'),
      rate_used: numOrNull(o.rate_used),
      complexity_level: complexityRaw && (COMPLEXITY_LEVEL_VALUES as string[]).includes(complexityRaw)
        ? (complexityRaw as ComplexityLevel) : null,
      urgency_level: urgencyRaw && (URGENCY_LEVEL_VALUES as string[]).includes(urgencyRaw)
        ? (urgencyRaw as UrgencyLevel) : null,
      comparable_records: strArray(o.comparable_records),
    };
    const createdBy = str(o, 'created_by') ?? str(o, 'createdBy') ?? 'usuario_interno';
    const brk = createBreakdown(input, createdBy);
    return created(brk);
  }

  // ---- GET /api/breakdowns ----
  if (method === 'GET' && !id) {
    const calcId = query.get('calculation_id');
    if (calcId) return ok(findBreakdownsByCalculation(calcId));
    return ok(listBreakdowns());
  }

  // ---- GET /api/breakdowns/:id ----
  if (method === 'GET' && id && !action) {
    const brk = getBreakdown(id);
    if (!brk) return notFound(`Desglose "${id}" no encontrado.`);
    return ok(brk);
  }

  // ---- PUT /api/breakdowns/:id ----
  if (method === 'PUT' && id && !action) {
    const patch = asObject(body) as Partial<PlannedActionBreakdown>;
    const updated = updateBreakdown(id, patch);
    if (!updated) return notFound(`Desglose "${id}" no encontrado.`);
    return ok(updated);
  }

  // ---- DELETE /api/breakdowns/:id ----
  if (method === 'DELETE' && id && !action) {
    const okDel = deleteBreakdown(id);
    if (!okDel) return notFound(`Desglose "${id}" no encontrado.`);
    return ok({ deleted: true, id });
  }

  // ---- POST /api/breakdowns/:id/export-word ----
  if (method === 'POST' && id && action === 'export-word') {
    const brk = getBreakdown(id);
    if (!brk) return notFound(`Desglose "${id}" no encontrado.`);
    const o = asObject(body);
    const generatedBy = str(o, 'generated_by') ?? str(o, 'generatedBy') ?? 'usuario_interno';
    const firmName = str(o, 'firm_name') ?? str(o, 'firmName');
    const { record, buffer } = saveBreakdownDocx(brk, generatedBy, { firmName });
    return ok({
      record,
      file_name: record.file_name,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_base64: buffer.toString('base64'),
    });
  }

  return badRequest(`Operación no soportada en /api/breakdowns (${method} ${segments.join('/')}).`);
}
