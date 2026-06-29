/**
 * recordReview — panel de revisión humana de registros extraídos (R15).
 *
 * Reglas aplicadas:
 *  - R4/R7: sólo un usuario interno aprueba; la aprobación exige `approved_by`.
 *  - R5: los registros llegan en `pending_review`; este módulo es el ÚNICO punto
 *    legítimo que mueve un registro a `approved` o `rejected`.
 *  - R12: no inventa datos; `updateRecord` sólo aplica el patch recibido y NUNCA
 *    permite cambiar el `id`.
 *
 * Sólo los registros `approved` deben usarse aguas abajo (generación de fórmulas
 * y cálculo). Este módulo no realiza esa selección; la hacen los consumidores.
 */

import { recordsRepo } from '../backend/storage/index.ts';
import { nowIso } from '../backend/utils/id.ts';
import type { ExtractedWorkRecord, ReviewStatus } from '../backend/models/index.ts';

/** Lista los registros pendientes de revisión. */
export function listPending(): ExtractedWorkRecord[] {
  return recordsRepo.find((r) => r.review_status === 'pending_review');
}

/** Lista los registros por estado de revisión. */
export function listByStatus(status: ReviewStatus): ExtractedWorkRecord[] {
  return recordsRepo.find((r) => r.review_status === status);
}

/**
 * Aplica un patch a un registro y lo persiste. NUNCA cambia el `id`.
 * Devuelve el registro actualizado, o null si no existe.
 */
export function updateRecord(
  id: string,
  patch: Partial<ExtractedWorkRecord>,
): ExtractedWorkRecord | null {
  const current = recordsRepo.get(id);
  if (!current) return null;
  // Descarta cualquier intento de reescribir el id (inmutable).
  const { id: _ignoredId, ...safePatch } = patch;
  const updated: ExtractedWorkRecord = { ...current, ...safePatch, id: current.id };
  return recordsRepo.save(updated);
}

/**
 * Aprueba un registro (R4/R7): review_status="approved", approved_by=arg,
 * approved_at=nowIso(), rejected_reason=null. Persiste y devuelve el registro.
 * Devuelve null si el registro no existe.
 */
export function approveRecord(id: string, approvedBy: string): ExtractedWorkRecord | null {
  const current = recordsRepo.get(id);
  if (!current) return null;
  const updated: ExtractedWorkRecord = {
    ...current,
    review_status: 'approved',
    approved_by: approvedBy,
    approved_at: nowIso(),
    rejected_reason: null,
  };
  return recordsRepo.save(updated);
}

/**
 * Aprueba EN LOTE todos los registros en pending_review (R4/R7), opcionalmente
 * filtrando por área (service_category). Pensado para procesar muchos registros
 * tras revisarlos por área. Devuelve cuántos se aprobaron y sus ids.
 */
export function approveBatch(approvedBy: string, serviceCategory?: string | null): { approved: number; ids: string[] } {
  const pending = recordsRepo.find(
    (r) => r.review_status === 'pending_review'
      && (!serviceCategory || r.service_category === serviceCategory),
  );
  const ids: string[] = [];
  for (const r of pending) {
    recordsRepo.save({
      ...r, review_status: 'approved', approved_by: approvedBy, approved_at: nowIso(), rejected_reason: null,
    });
    ids.push(r.id);
  }
  return { approved: ids.length, ids };
}

/**
 * Rechaza un registro: review_status="rejected", rejected_reason, approved_by=null,
 * approved_at=null. Persiste y devuelve el registro. Null si no existe.
 * `by` queda anotado en `notes` para trazabilidad de quién rechazó.
 */
export function rejectRecord(
  id: string,
  rejectedReason: string,
  by: string,
): ExtractedWorkRecord | null {
  const current = recordsRepo.get(id);
  if (!current) return null;
  const note = `Rechazado por ${by} el ${nowIso()}`;
  const updated: ExtractedWorkRecord = {
    ...current,
    review_status: 'rejected',
    rejected_reason: rejectedReason,
    approved_by: null,
    approved_at: null,
    notes: current.notes ? `${current.notes}\n${note}` : note,
  };
  return recordsRepo.save(updated);
}
