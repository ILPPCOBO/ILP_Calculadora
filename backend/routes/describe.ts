/**
 * Ruta /api/estimate-case — estimación de horas y honorarios desde una
 * descripción en lenguaje natural (pantalla "Describir caso").
 *
 * POST /api/estimate-case  body: { description, area?, urgency?, complexity?,
 *   hourly_rate?, discount_percentage?, created_by? }
 * Orquesta caseEstimator.estimateAndSaveCase (guarda en historial, R17).
 */

import { estimateAndSaveCase } from '../../services/caseEstimator.ts';
import type { CaseInput } from '../../services/caseEstimator.ts';
import {
  COMPLEXITY_LEVEL_VALUES, URGENCY_LEVEL_VALUES,
} from '../models/index.ts';
import type { ComplexityLevel, UrgencyLevel } from '../models/index.ts';
import { ok, badRequest, asObject, str } from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function handleEstimateCase(ctx: RouteContext): Promise<RouteResult> {
  if (ctx.method !== 'POST') return badRequest('Use POST en /api/estimate-case con { description }.');

  const o = asObject(ctx.body);
  const description = str(o, 'description');
  if (!description || description.trim() === '') {
    return badRequest('Falta "description": describe el caso en lenguaje natural.');
  }

  const complexityRaw = str(o, 'complexity') ?? str(o, 'complexity_level');
  const urgencyRaw = str(o, 'urgency') ?? str(o, 'urgency_level');

  const input: CaseInput = {
    description: description.trim(),
    area: str(o, 'area'),
    complexity: complexityRaw && (COMPLEXITY_LEVEL_VALUES as string[]).includes(complexityRaw)
      ? (complexityRaw as ComplexityLevel) : undefined,
    urgency: urgencyRaw && (URGENCY_LEVEL_VALUES as string[]).includes(urgencyRaw)
      ? (urgencyRaw as UrgencyLevel) : undefined,
    hourly_rate: numOrNull(o.hourly_rate),
    discount_percentage: numOrNull(o.discount_percentage),
  };

  const createdBy = str(o, 'created_by') ?? str(o, 'createdBy') ?? 'usuario_interno';
  const estimate = estimateAndSaveCase(input, createdBy);
  return ok(estimate);
}
