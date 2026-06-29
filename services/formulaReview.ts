/**
 * formulaReview — panel de revisión humana de fórmulas (R4, R6, R7, R15).
 *
 * La IA genera fórmulas en `pending_review`; SÓLO un usuario interno puede
 * aprobarlas o rechazarlas aquí. Una fórmula aprobada se copia a
 * `approvedFormulasRepo` para que la calculadora final pueda usarla (R3).
 *
 * Regla de aprobación (R13 fórmulas): no se aprueba si faltan
 *  - service_category,
 *  - formula_expression,
 *  - variables (no vacío),
 *  - assumptions (no vacío),
 *  - y (based_on_record_ids no vacío O alguna assumption que justifique el uso
 *    de la tarifa base).
 */

import { formulasRepo, approvedFormulasRepo } from '../backend/storage/index.ts';
import { nowIso } from '../backend/utils/id.ts';
import { BASE_HOURLY_RATE } from '../backend/config/factors.ts';
import type { PricingFormula, ReviewStatus } from '../backend/models/index.ts';

/** Fórmulas que esperan revisión humana. */
export function listPending(): PricingFormula[] {
  return formulasRepo.find((f) => f.review_status === 'pending_review');
}

/** Fórmulas por estado de revisión. */
export function listByStatus(status: ReviewStatus): PricingFormula[] {
  return formulasRepo.find((f) => f.review_status === status);
}

/**
 * Edita campos de una fórmula (revisión manual, R15) y refresca `updated_at`.
 * No cambia `review_status` salvo que el patch lo incluya explícitamente.
 */
export function updateFormula(id: string, patch: Partial<PricingFormula>): PricingFormula | null {
  const current = formulasRepo.get(id);
  if (!current) return null;
  const updated: PricingFormula = {
    ...current,
    ...patch,
    id: current.id, // el id nunca se sobrescribe
    updated_at: nowIso(),
  };
  formulasRepo.save(updated);
  return updated;
}

/** ¿Alguna assumption justifica el uso de la tarifa base (250)? */
function assumptionsJustifyBaseRate(f: PricingFormula): boolean {
  const base = String(BASE_HOURLY_RATE);
  return (f.assumptions ?? []).some((a) => {
    const text = a.toLowerCase();
    return text.includes('tarifa base') || text.includes(base);
  });
}

/**
 * Comprueba si una fórmula es aprobable. Devuelve la lista de campos que faltan.
 */
export function canApprove(f: PricingFormula): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!f.service_category || f.service_category.trim() === '') {
    missing.push('service_category');
  }
  if (!f.formula_expression || f.formula_expression.trim() === '') {
    missing.push('formula_expression');
  }
  if (!Array.isArray(f.variables) || f.variables.length === 0) {
    missing.push('variables');
  }
  if (!Array.isArray(f.assumptions) || f.assumptions.length === 0) {
    missing.push('assumptions');
  }

  // Debe haber respaldo: registros usados O justificación de tarifa base.
  const hasRecords = Array.isArray(f.based_on_record_ids) && f.based_on_record_ids.length > 0;
  if (!hasRecords && !assumptionsJustifyBaseRate(f)) {
    missing.push('based_on_record_ids_or_base_rate_assumption');
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Aprueba una fórmula (R4/R7): valida con `canApprove`, marca `approved`,
 * registra quién y cuándo, persiste en `formulasRepo` y COPIA a
 * `approvedFormulasRepo` (misma id) para uso de la calculadora.
 */
export function approveFormula(
  id: string,
  approvedBy: string,
): { ok: boolean; formula?: PricingFormula; missing?: string[] } {
  const current = formulasRepo.get(id);
  if (!current) return { ok: false, missing: ['formula_not_found'] };

  const check = canApprove(current);
  if (!check.ok) return { ok: false, missing: check.missing };

  const now = nowIso();
  const approved: PricingFormula = {
    ...current,
    review_status: 'approved',
    approved_by: approvedBy,
    approved_at: now,
    rejected_reason: null,
    updated_at: now,
  };
  formulasRepo.save(approved);
  approvedFormulasRepo.save(approved); // misma id; copia usable por la calculadora.
  return { ok: true, formula: approved };
}

/**
 * Rechaza una fórmula: marca `rejected` con motivo y persiste en `formulasRepo`.
 * No toca `approvedFormulasRepo`.
 */
export function rejectFormula(
  id: string,
  rejectedReason: string,
  by: string,
): PricingFormula | null {
  const current = formulasRepo.get(id);
  if (!current) return null;

  const now = nowIso();
  const rejected: PricingFormula = {
    ...current,
    review_status: 'rejected',
    rejected_reason: rejectedReason,
    approved_by: null,
    approved_at: null,
    updated_at: now,
    notes: by ? `Rechazada por ${by}.` : current.notes ?? null,
  };
  formulasRepo.save(rejected);
  return rejected;
}
