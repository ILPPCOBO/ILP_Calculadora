/**
 * feeCalculator — motor de cálculo final de honorarios sugeridos.
 *
 * Reglas aplicadas:
 *  - R2/R15: si `hourly_rate` viene vacío se usa `base_hourly_rate` (250 €/h).
 *  - R3/R12: sólo usa fórmulas `approved` y registros `approved`. Nunca inventa.
 *  - R9/R10/R18: la salida explicita la fórmula usada, los registros que la
 *    respaldan y una explicación trazable.
 *  - R11: si no hay fórmula aprobada ni histórico, avisa con confianza baja.
 *  - R13: siempre devuelve mínimo, recomendado y máximo (salvo que falten horas).
 *  - R14: confidence_level low | medium | high.
 *  - R17: `saveCalculation` persiste el cálculo en el historial.
 *
 * NO evaluamos `formula_expression` como código (seguridad): interpretamos el
 * `formula_type` con un motor determinista.
 */

import { loadConfig, BASE_HOURLY_RATE, discountFactor } from '../backend/config/factors.ts';
import { approvedFormulasRepo, recordsRepo, calculationsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { buildReference } from './referencePricing.ts';
import type { PriceReference } from './referencePricing.ts';
import type {
  ComplexityLevel, UrgencyLevel, FeeType, ConfidenceLevel,
  PricingFormula, ExtractedWorkRecord, FeeCalculation,
} from '../backend/models/index.ts';

export interface CalcInput {
  service_category: string;
  service_subcategory?: string | null;
  estimated_hours: number | null;
  /** Meses de duración para honorario MENSUAL (iguala). Por defecto 1. */
  estimated_months?: number | null;
  professional_role?: string | null;
  /** Si es null/undefined/<=0 se usa la tarifa base. */
  hourly_rate?: number | null;
  /** Override de tarifa base; por defecto 250 (config). */
  base_hourly_rate?: number;
  complexity_level?: ComplexityLevel;
  urgency_level?: UrgencyLevel;
  fee_type?: FeeType;
  discount_percentage?: number | null;
  /** Forzar una fórmula concreta (opcional). Si no, se busca la aprobada de la categoría. */
  selected_formula_id?: string | null;
}

export interface CalcOutput {
  calculated_min: number | null;
  calculated_recommended: number | null;
  calculated_max: number | null;
  currency: string;
  confidence_level: ConfidenceLevel;
  /** Nombre/identificador legible de la fórmula usada, o "Tarifa base 250 €/h". */
  formula_used: string;
  selected_formula_id: string | null;
  explanation: string;
  comparable_records: string[];
  /** Referencia histórica de precios del área (acuerdos aprobados que respaldan el cálculo). */
  reference: PriceReference | null;
  warnings: string[];
  /** true cuando faltan datos imprescindibles (p.ej. horas) y NO se calcula. */
  needs_input: boolean;
  /** Detalle de factores aplicados, para la trazabilidad de la UI. */
  breakdown: {
    used_base_rate: boolean;
    effective_hourly_rate: number;
    complexity_factor: number;
    urgency_factor: number;
    discount_factor: number;
    historical_p25?: number;
    historical_median?: number;
    historical_p75?: number;
  };
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Busca la fórmula aprobada aplicable a la categoría/subcategoría. */
export function findApprovedFormula(
  category: string,
  subcategory?: string | null,
  forcedId?: string | null,
): PricingFormula | null {
  const approved = approvedFormulasRepo.list().filter((f) => f.review_status === 'approved');
  if (forcedId) {
    return approved.find((f) => f.id === forcedId) ?? null;
  }
  // Coincidencia exacta de subcategoría primero, luego sólo categoría.
  const exact = approved.find(
    (f) => f.service_category === category && (subcategory ?? null) !== null && f.service_subcategory === subcategory,
  );
  if (exact) return exact;
  return approved.find((f) => f.service_category === category) ?? null;
}

/** Registros históricos aprobados comparables (misma categoría, con importe). */
export function comparableRecords(category: string, subcategory?: string | null): ExtractedWorkRecord[] {
  const approved = recordsRepo.list().filter((r) => r.review_status === 'approved' && r.service_category === category);
  const withSub = subcategory
    ? approved.filter((r) => r.service_subcategory === subcategory)
    : [];
  // Si hay coincidencias de subcategoría usamos esas; si no, toda la categoría.
  const pool = withSub.length > 0 ? withSub : approved;
  return pool.filter((r) => typeof r.total_fee === 'number' && r.total_fee! > 0);
}

/**
 * Calcula el honorario sugerido (función PURA: no persiste nada).
 */
export function calculateFee(input: CalcInput): CalcOutput {
  const cfg = loadConfig();
  const currency = cfg.currency;
  const complexity: ComplexityLevel = input.complexity_level ?? 'medium';
  const urgency: UrgencyLevel = input.urgency_level ?? 'normal';
  const baseRate = input.base_hourly_rate && input.base_hourly_rate > 0 ? input.base_hourly_rate : BASE_HOURLY_RATE;

  const usedBaseRate = !(typeof input.hourly_rate === 'number' && input.hourly_rate > 0);
  const effectiveRate = usedBaseRate ? baseRate : (input.hourly_rate as number);

  const cf = cfg.complexity_factor[complexity];
  const uf = cfg.urgency_factor[urgency];
  const df = discountFactor(input.discount_percentage);

  const formula = findApprovedFormula(input.service_category, input.service_subcategory, input.selected_formula_id);
  const comparables = comparableRecords(input.service_category, input.service_subcategory);
  // Referencia histórica del área (acuerdos aprobados): se adjunta a la salida como
  // contexto y respaldo del cálculo (R3/R10/R18).
  const reference = buildReference(input.service_category, input.service_subcategory ?? null);

  const warnings: string[] = [];
  const breakdown: CalcOutput['breakdown'] = {
    used_base_rate: usedBaseRate,
    effective_hourly_rate: effectiveRate,
    complexity_factor: cf,
    urgency_factor: uf,
    discount_factor: df,
  };

  // ===================================================================
  // Modelo ESPAÑOL: precio fijo / iguala mensual (sin horas).
  // Si NO hay fórmula aprobada y el área se factura por precio fijo o iguala
  // mensual (lo pide el usuario o es el modelo predominante histórico), el
  // honorario se deriva de los IMPORTES históricos aprobados (referencia),
  // no de horas. (R3/R10/R13)
  // ===================================================================
  const requestedModel = (input.fee_type && input.fee_type !== 'unknown') ? input.fee_type : null;
  const wantsFixedMonthly = requestedModel === 'fixed' || requestedModel === 'monthly'
    || (requestedModel === null && (reference.predominant_fee_type === 'fixed' || reference.predominant_fee_type === 'monthly'));

  if (!formula && wantsFixedMonthly && reference.fee_median != null) {
    const model: 'fixed' | 'monthly' = (requestedModel === 'fixed' || requestedModel === 'monthly')
      ? requestedModel
      : (reference.predominant_fee_type as 'fixed' | 'monthly');
    const months = model === 'monthly' && input.estimated_months && input.estimated_months > 0
      ? input.estimated_months : 1;
    const factor = cf * uf * df;
    const baseMed = reference.fee_median as number;
    const baseMin = reference.fee_p25 ?? baseMed;
    const baseMax = reference.fee_p75 ?? baseMed;
    const lo = baseMin * months * factor;
    const hi = baseMax * months * factor;
    const unidad = model === 'monthly' ? `${currency}/mes` : currency;
    const parts: string[] = [];
    parts.push(model === 'monthly'
      ? `Esta área se factura por IGUALA MENSUAL. Se parte de la mediana histórica de ${round2(baseMed)} ${unidad}${months > 1 ? ` × ${months} meses` : ''}.`
      : `Esta área se factura a PRECIO FIJO. Se parte de la mediana histórica de ${round2(baseMed)} ${currency}.`);
    parts.push(`Ajustado por complejidad ${complexity} (factor ${cf}), urgencia ${urgency} (factor ${uf}) y ${df === 1 ? 'sin descuento' : `descuento (factor ${round2(df)})`}.`);
    parts.push(`Basado en ${reference.sample_size} acuerdo(s) aprobado(s) de esta área (P25–P75: ${round2(baseMin)}–${round2(baseMax)} ${unidad}).`);
    breakdown.historical_p25 = round2(baseMin);
    breakdown.historical_median = round2(baseMed);
    breakdown.historical_p75 = round2(baseMax);
    return {
      calculated_min: round2(Math.min(lo, hi)),
      calculated_recommended: round2(baseMed * months * factor),
      calculated_max: round2(Math.max(lo, hi)),
      currency,
      confidence_level: reference.confidence_level,
      formula_used: model === 'monthly'
        ? `Iguala mensual histórica (${reference.sample_size} acuerdos)`
        : `Precio fijo histórico (${reference.sample_size} acuerdos)`,
      selected_formula_id: null,
      explanation: parts.join(' '),
      comparable_records: reference.based_on_record_ids,
      reference,
      warnings: model === 'monthly' && months === 1
        ? ['Importe MENSUAL (iguala). Indica los meses de duración para el total del periodo.']
        : [],
      needs_input: false,
      breakdown,
    };
  }

  // Pidió precio fijo / mensual pero NO hay histórico aprobado ni fórmula -> R11.
  if (!formula && (requestedModel === 'fixed' || requestedModel === 'monthly') && reference.fee_median == null) {
    return {
      calculated_min: null,
      calculated_recommended: null,
      calculated_max: null,
      currency,
      confidence_level: 'low',
      formula_used: '—',
      selected_formula_id: null,
      explanation: `No hay acuerdos históricos aprobados de ${requestedModel === 'monthly' ? 'iguala mensual' : 'precio fijo'} en esta área para sugerir un importe. Aprueba registros de esta área o usa el cálculo por horas.`,
      comparable_records: [],
      reference,
      warnings: ['Información insuficiente: sin acuerdos aprobados de este tipo en el área (Regla 11).'],
      needs_input: true,
      breakdown,
    };
  }

  // ----- R26: faltan horas y la fórmula necesita horas -> no calcular -----
  const formulaNeedsHours = !formula || formula.formula_type === 'hourly' || formula.formula_type === 'blended' || formula.formula_type === 'custom';
  const hasHours = typeof input.estimated_hours === 'number' && input.estimated_hours > 0;
  if (!hasHours && formulaNeedsHours) {
    return {
      calculated_min: null,
      calculated_recommended: null,
      calculated_max: null,
      currency,
      confidence_level: 'low',
      formula_used: '—',
      selected_formula_id: formula?.id ?? null,
      explanation: 'No se puede calcular sin las horas estimadas. Introduce un número de horas mayor que cero.',
      comparable_records: [],
      reference,
      warnings: ['Faltan horas estimadas. Introduce las horas para poder calcular.'],
      needs_input: true,
      breakdown,
    };
  }

  const hours = hasHours ? (input.estimated_hours as number) : 0;
  let recommended: number;
  let formulaUsed: string;
  let confidence: ConfidenceLevel;
  const explanationParts: string[] = [];

  if (!formula) {
    // ----- R11/R25: sin fórmula aprobada -> fórmula base temporal -----
    recommended = hours * baseRate * cf * uf * df;
    formulaUsed = `Tarifa base ${baseRate} €/h (sin fórmula aprobada)`;
    confidence = 'low';
    warnings.push('Cálculo basado en tarifa base, no en fórmula aprobada específica.');
    if (comparables.length === 0) {
      warnings.push('Información insuficiente: no hay fórmula aprobada ni registros históricos aprobados para esta categoría.');
    }
    explanationParts.push(
      usedBaseRate
        ? `Se usó la tarifa base de ${baseRate} €/hora porque no se introdujo una tarifa personalizada.`
        : `Se usó la tarifa introducida de ${effectiveRate} €/hora.`,
    );
    explanationParts.push(
      `El cálculo aplica ${hours} horas estimadas, complejidad ${complexity} (factor ${cf}), urgencia ${urgency} (factor ${uf}) y ${df === 1 ? 'sin descuento' : `descuento (factor ${round2(df)})`}.`,
    );
  } else {
    // ----- R3/R12: fórmula aprobada -----
    formulaUsed = `${formula.formula_name} [${formula.id}]`;
    const rate = usedBaseRate ? baseRate : effectiveRate;
    if (formula.formula_type === 'fixed_range' || formula.formula_type === 'monthly') {
      const base = formula.recommended_base ?? (formula.recommended_min ?? 0);
      recommended = base * cf * uf * df;
      explanationParts.push(`Se aplicó la fórmula aprobada "${formula.formula_name}" (${formula.formula_type}) con base ${base} ${currency}.`);
    } else {
      // hourly / blended / custom
      recommended = hours * rate * cf * uf * df;
      explanationParts.push(
        usedBaseRate
          ? `Se aplicó la fórmula aprobada "${formula.formula_name}" usando la tarifa base ${baseRate} €/hora (no se introdujo tarifa personalizada).`
          : `Se aplicó la fórmula aprobada "${formula.formula_name}" con tarifa ${effectiveRate} €/hora.`,
      );
      explanationParts.push(
        `Aplica ${hours} horas estimadas, complejidad ${complexity} (factor ${cf}), urgencia ${urgency} (factor ${uf}) y ${df === 1 ? 'sin descuento' : `descuento (factor ${round2(df)})`}.`,
      );
    }
    confidence = comparables.length >= 3 ? 'high' : 'medium';
  }

  // ----- R13: rango mínimo / recomendado / máximo -----
  let min: number;
  let max: number;
  const spread = cfg.range_spread_no_history;

  if (comparables.length >= 3) {
    const fees = comparables.map((r) => r.total_fee as number).sort((a, b) => a - b);
    const p25 = percentile(fees, 0.25);
    const median = percentile(fees, 0.5);
    const p75 = percentile(fees, 0.75);
    breakdown.historical_p25 = round2(p25);
    breakdown.historical_median = round2(median);
    breakdown.historical_p75 = round2(p75);
    // Combina la fórmula con los percentiles históricos: el rango envuelve ambos.
    min = Math.min(recommended * (1 - spread), p25);
    max = Math.max(recommended * (1 + spread), p75);
    explanationParts.push(
      `Rango ajustado con ${comparables.length} registros históricos comparables (p25=${round2(p25)}, mediana=${round2(median)}, p75=${round2(p75)} ${currency}).`,
    );
  } else {
    min = recommended * (1 - spread);
    max = recommended * (1 + spread);
    explanationParts.push(`El rango sugerido se calcula con una variación de ±${Math.round(spread * 100)}% sobre el honorario recomendado.`);
    if (comparables.length > 0) {
      explanationParts.push(`Hay ${comparables.length} registro(s) comparable(s), insuficientes para ajustar el rango por percentiles.`);
    }
  }

  return {
    calculated_min: round2(min),
    calculated_recommended: round2(recommended),
    calculated_max: round2(max),
    currency,
    confidence_level: confidence,
    formula_used: formulaUsed,
    selected_formula_id: formula?.id ?? null,
    explanation: explanationParts.join(' '),
    comparable_records: comparables.map((r) => r.id),
    reference,
    warnings,
    needs_input: false,
    breakdown,
  };
}

/**
 * Calcula y PERSISTE el cálculo en el historial (R17). Devuelve el registro guardado.
 * Si faltan horas, igualmente guarda el intento marcado con warning (needs_input).
 */
export function saveCalculation(input: CalcInput, createdBy: string): { output: CalcOutput; record: FeeCalculation } {
  const output = calculateFee(input);
  const record: FeeCalculation = {
    id: newId('calc'),
    service_category: input.service_category,
    service_subcategory: input.service_subcategory ?? null,
    estimated_hours: input.estimated_hours ?? null,
    professional_role: input.professional_role ?? null,
    hourly_rate: typeof input.hourly_rate === 'number' ? input.hourly_rate : null,
    base_hourly_rate: input.base_hourly_rate && input.base_hourly_rate > 0 ? input.base_hourly_rate : BASE_HOURLY_RATE,
    complexity_level: input.complexity_level ?? 'medium',
    urgency_level: input.urgency_level ?? 'normal',
    fee_type: input.fee_type ?? 'hourly',
    discount_percentage: input.discount_percentage ?? null,
    selected_formula_id: output.selected_formula_id,
    calculated_min: output.calculated_min,
    calculated_recommended: output.calculated_recommended,
    calculated_max: output.calculated_max,
    currency: output.currency,
    confidence_level: output.confidence_level,
    explanation: output.explanation,
    comparable_record_ids: output.comparable_records,
    warnings: output.warnings,
    created_at: nowIso(),
    created_by: createdBy,
  };
  calculationsRepo.save(record);
  return { output, record };
}
