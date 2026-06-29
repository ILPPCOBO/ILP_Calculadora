/**
 * formulaGenerator — generador de fórmulas de honorarios sugeridas.
 *
 * Reglas aplicadas:
 *  - R3/R12: SÓLO consume `ExtractedWorkRecord` con `review_status: "approved"`.
 *    Nunca usa registros pendientes ni inventa horas/precios.
 *  - R6: toda fórmula generada nace con `review_status: "pending_review"`.
 *  - R2: si hay pocos o ningún dato histórico se usa `BASE_HOURLY_RATE` (250 €/h)
 *    como referencia, justificándolo en una assumption.
 *  - R13: si hay datos suficientes (>=3 registros con importe) propone un
 *    rango (mín = p25, base = mediana, máx = p75).
 *  - R14: nivel de confianza low | medium | high según cantidad de datos.
 *
 * No persiste salvo `generateAndSaveFormula`, que escribe vía `formulasRepo`.
 */

import { BASE_HOURLY_RATE, DEFAULT_CURRENCY } from '../backend/config/factors.ts';
import { recordsRepo, formulasRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import type {
  ConfidenceLevel, FormulaType, FormulaVariable,
  PricingFormula, ExtractedWorkRecord,
} from '../backend/models/index.ts';

export interface GenerateInput {
  service_category: string;
  service_subcategory?: string | null;
  formula_type?: FormulaType;
  created_by?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Percentil lineal sobre un array YA ordenado ascendente. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Variables estándar de una fórmula horaria, con sus valores por defecto. */
function defaultVariables(): FormulaVariable[] {
  return [
    { name: 'estimated_hours', description: 'Horas estimadas para el encargo.', default: null },
    { name: 'hourly_rate', description: `Tarifa por hora aplicada (€/h). Por defecto la tarifa base ${BASE_HOURLY_RATE}.`, default: BASE_HOURLY_RATE },
    { name: 'complexity_factor', description: 'Factor de complejidad (low 0.85, medium 1.0, high 1.3).', default: 1.0 },
    { name: 'urgency_factor', description: 'Factor de urgencia (normal 1.0, urgent 1.2, very_urgent 1.4).', default: 1.0 },
    { name: 'discount_factor', description: 'Factor de descuento: 1 - (descuento%/100). Sin descuento = 1.0.', default: 1.0 },
  ];
}

/**
 * Selecciona los registros aprobados de la categoría/subcategoría pedida.
 * R3/R12: SÓLO `review_status === 'approved'`. Nunca toca pendientes/rechazados.
 * Si se pide subcategoría y hay coincidencias, se restringe a esas; si no, toda
 * la categoría.
 */
function approvedRecordsFor(category: string, subcategory?: string | null): ExtractedWorkRecord[] {
  const approved = recordsRepo.find(
    (r) => r.review_status === 'approved' && r.service_category === category,
  );
  if (subcategory) {
    const withSub = approved.filter((r) => r.service_subcategory === subcategory);
    if (withSub.length > 0) return withSub;
  }
  return approved;
}

/**
 * Genera una `PricingFormula` (función PURA: NO persiste).
 * Siempre devuelve `review_status: "pending_review"` (R6).
 */
export function generateFormula(input: GenerateInput): PricingFormula {
  const category = input.service_category;
  const subcategory = input.service_subcategory ?? null;
  const now = nowIso();

  const records = approvedRecordsFor(category, subcategory);
  const recordsWithFee = records.filter(
    (r) => typeof r.total_fee === 'number' && (r.total_fee as number) > 0,
  );
  const recordsWithHourly = records.filter(
    (r) => typeof r.hours_worked === 'number' && (r.hours_worked as number) > 0
      && typeof r.hourly_rate === 'number' && (r.hourly_rate as number) > 0,
  );

  const subLabel = subcategory ? ` / ${subcategory}` : '';
  const variables = defaultVariables();

  let formulaType: FormulaType;
  let formulaExpression: string;
  let recommendedMin: number | null = null;
  let recommendedBase: number | null = null;
  let recommendedMax: number | null = null;
  let confidence: ConfidenceLevel;
  const assumptions: string[] = [];
  let basedOnIds: string[] = [];

  // ---- Caso 1: hay suficiente histórico de importes -> rango fijo (R13) ----
  if (recordsWithFee.length >= 3) {
    const fees = recordsWithFee
      .map((r) => r.total_fee as number)
      .sort((a, b) => a - b);
    const p25 = round2(percentile(fees, 0.25));
    const median = round2(percentile(fees, 0.5));
    const p75 = round2(percentile(fees, 0.75));

    formulaType = input.formula_type ?? 'fixed_range';
    recommendedMin = p25;
    recommendedBase = median;
    recommendedMax = p75;
    basedOnIds = recordsWithFee.map((r) => r.id);
    formulaExpression = `rango fijo: min=${p25}, base=${median}, max=${p75} ${DEFAULT_CURRENCY} (percentiles p25/mediana/p75 del histórico aprobado)`;
    confidence = recordsWithFee.length >= 5 ? 'high' : 'medium';

    assumptions.push(
      `Rango calculado a partir de ${recordsWithFee.length} registro(s) aprobado(s) con importe para "${category}${subLabel}".`,
    );
    assumptions.push(
      `Mínimo = p25 (${p25} ${DEFAULT_CURRENCY}), recomendado = mediana (${median} ${DEFAULT_CURRENCY}), máximo = p75 (${p75} ${DEFAULT_CURRENCY}).`,
    );

    // Si además hay datos de horas+tarifa, lo dejamos anotado como referencia.
    if (recordsWithHourly.length > 0) {
      const rates = recordsWithHourly.map((r) => r.hourly_rate as number).sort((a, b) => a - b);
      const medRate = round2(percentile(rates, 0.5));
      assumptions.push(
        `Referencia horaria: ${recordsWithHourly.length} registro(s) con horas y tarifa; tarifa horaria mediana observada ${medRate} ${DEFAULT_CURRENCY}/h.`,
      );
    }
  } else if (recordsWithHourly.length >= 1 && (input.formula_type === 'hourly' || recordsWithFee.length === 0)) {
    // ---- Caso 2: hay datos de horas+tarifa -> fórmula horaria (R3) ----
    const rates = recordsWithHourly.map((r) => r.hourly_rate as number).sort((a, b) => a - b);
    const medRate = round2(percentile(rates, 0.5));

    formulaType = 'hourly';
    formulaExpression = 'estimated_hours * hourly_rate * complexity_factor * urgency_factor * discount_factor';
    basedOnIds = recordsWithHourly.map((r) => r.id);
    confidence = recordsWithHourly.length >= 5 ? 'high' : recordsWithHourly.length >= 3 ? 'medium' : 'low';

    // hourly_rate por defecto = tarifa horaria mediana observada en el histórico.
    const hr = variables.find((v) => v.name === 'hourly_rate');
    if (hr) {
      hr.default = medRate;
      hr.description = `Tarifa por hora aplicada (€/h). Tarifa horaria mediana observada en el histórico aprobado: ${medRate}.`;
    }

    assumptions.push(
      `Fórmula horaria basada en ${recordsWithHourly.length} registro(s) aprobado(s) con horas y tarifa para "${category}${subLabel}".`,
    );
    assumptions.push(
      `Tarifa horaria mediana observada: ${medRate} ${DEFAULT_CURRENCY}/h.`,
    );
  } else {
    // ---- Caso 3: pocos o ningún dato -> tarifa base 250 (R2/R11) ----
    formulaType = input.formula_type ?? 'hourly';
    formulaExpression = `estimated_hours * ${BASE_HOURLY_RATE} * complexity_factor * urgency_factor * discount_factor`;
    basedOnIds = recordsWithFee.map((r) => r.id); // puede quedar vacío
    confidence = recordsWithFee.length >= 1 || recordsWithHourly.length >= 1 ? 'medium' : 'low';

    const hr = variables.find((v) => v.name === 'hourly_rate');
    if (hr) hr.default = BASE_HOURLY_RATE;

    // Assumption que JUSTIFICA el uso de la tarifa base (satisface canApprove).
    assumptions.push(
      `No hay suficientes registros históricos aprobados con importe para "${category}${subLabel}"; se usa la tarifa base de ${BASE_HOURLY_RATE} ${DEFAULT_CURRENCY}/h (regla 2) como referencia.`,
    );
    if (recordsWithFee.length >= 1) {
      assumptions.push(
        `Sólo se hallaron ${recordsWithFee.length} registro(s) con importe (se requieren 3 para construir un rango por percentiles).`,
      );
    } else {
      assumptions.push(
        'No se hallaron registros aprobados con importe; la fórmula es una estimación basada únicamente en la tarifa base.',
      );
    }
  }

  const formulaName = formulaType === 'fixed_range'
    ? `Rango sugerido — ${category}${subLabel}`
    : `Tarifa horaria sugerida — ${category}${subLabel}`;

  const formula: PricingFormula = {
    id: newId('formula'),
    service_category: category,
    service_subcategory: subcategory,
    formula_name: formulaName,
    formula_type: formulaType,
    formula_expression: formulaExpression,
    variables,
    assumptions,
    based_on_record_ids: basedOnIds,
    recommended_min: recommendedMin,
    recommended_base: recommendedBase,
    recommended_max: recommendedMax,
    currency: DEFAULT_CURRENCY,
    confidence_level: confidence,
    review_status: 'pending_review', // R6: SIEMPRE pendiente al generar.
    approved_by: null,
    approved_at: null,
    created_at: now,
    updated_at: now,
    rejected_reason: null,
    notes: null,
  };

  return formula;
}

/**
 * Genera y PERSISTE la fórmula vía `formulasRepo` (sigue en pending_review).
 */
export function generateAndSaveFormula(input: GenerateInput): PricingFormula {
  const formula = generateFormula(input);
  formulasRepo.save(formula);
  return formula;
}
