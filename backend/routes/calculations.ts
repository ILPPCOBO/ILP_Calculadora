/**
 * Rutas /api/calculate y /api/calculations — motor de cálculo e historial (R17).
 *
 * Orquesta feeCalculator. NO reimplementa lógica:
 *  - POST /api/calculate     -> saveCalculation(input, created_by); devuelve el CalcOutput
 *  - GET  /api/calculations  -> historial (más recientes primero)
 *
 * El body de /api/calculate es un CalcInput + created_by. Devolvemos el CalcOutput
 * (lo que la calculadora del frontend espera) e incluimos también el id del
 * registro persistido para trazabilidad.
 */

import { saveCalculation } from '../../services/feeCalculator.ts';
import type { CalcInput } from '../../services/feeCalculator.ts';
import { calculationsRepo } from '../storage/index.ts';
import {
  COMPLEXITY_LEVEL_VALUES, URGENCY_LEVEL_VALUES, FEE_TYPE_VALUES,
} from '../models/index.ts';
import type { ComplexityLevel, UrgencyLevel, FeeType } from '../models/index.ts';
import {
  ok, created, badRequest, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function numOrUndef(value: unknown): number | undefined {
  const n = numOrNull(value);
  return n === null ? undefined : n;
}

export async function handleCalculate(ctx: RouteContext): Promise<RouteResult> {
  const { method, body } = ctx;
  if (method !== 'POST') return badRequest('Use POST en /api/calculate.');

  const o = asObject(body);
  const category = str(o, 'service_category');
  if (!category || category.trim() === '') {
    return badRequest('Falta "service_category".');
  }

  const complexityRaw = str(o, 'complexity_level');
  const urgencyRaw = str(o, 'urgency_level');
  const feeTypeRaw = str(o, 'fee_type');

  const input: CalcInput = {
    service_category: category.trim(),
    service_subcategory: str(o, 'service_subcategory'),
    estimated_hours: numOrNull(o.estimated_hours),
    professional_role: str(o, 'professional_role'),
    hourly_rate: numOrNull(o.hourly_rate),
    base_hourly_rate: numOrUndef(o.base_hourly_rate),
    complexity_level: complexityRaw && (COMPLEXITY_LEVEL_VALUES as string[]).includes(complexityRaw)
      ? (complexityRaw as ComplexityLevel) : undefined,
    urgency_level: urgencyRaw && (URGENCY_LEVEL_VALUES as string[]).includes(urgencyRaw)
      ? (urgencyRaw as UrgencyLevel) : undefined,
    fee_type: feeTypeRaw && (FEE_TYPE_VALUES as string[]).includes(feeTypeRaw)
      ? (feeTypeRaw as FeeType) : undefined,
    discount_percentage: numOrNull(o.discount_percentage),
    selected_formula_id: str(o, 'selected_formula_id'),
  };

  const createdBy = str(o, 'created_by') ?? str(o, 'createdBy') ?? 'desconocido';
  const { output, record } = saveCalculation(input, createdBy);
  // Devolvemos el CalcOutput (lo que consume la calculadora) + el id persistido.
  return ok({ ...output, calculation_id: record.id, created_at: record.created_at });
}

export async function handleCalculations(ctx: RouteContext): Promise<RouteResult> {
  const { method } = ctx;
  if (method !== 'GET') return badRequest('Use GET en /api/calculations.');
  const all = calculationsRepo.list()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // más recientes primero
  return ok(all);
}
