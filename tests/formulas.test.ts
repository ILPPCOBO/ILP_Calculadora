/**
 * Tests 11-14 — Generación y revisión de FÓRMULAS.
 *
 * Aislamiento: usamos categorías de test dedicadas ("__test_formula__",
 * "__test_formula_pending__") que NO colisionan con el seed. Toda fórmula que
 * creamos se borra por id en after()/finally. NUNCA llamamos repo.clear().
 *
 * Reglas verificadas:
 *  - R6: toda fórmula generada nace en "pending_review".
 *  - R3/R12 (calculadora): sólo fórmulas "approved" se usan aguas abajo.
 *  - R13 (fórmulas): no se aprueba sin variables ni assumptions.
 *  - R2: con pocos/ningún registro la fórmula referencia la tarifa base 250.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { generateFormula, generateAndSaveFormula } from '../services/formulaGenerator.ts';
import * as formulaReview from '../services/formulaReview.ts';
import { findApprovedFormula } from '../services/feeCalculator.ts';
import { formulasRepo, approvedFormulasRepo } from '../backend/storage/index.ts';
import { BASE_HOURLY_RATE } from '../backend/config/factors.ts';
import type { PricingFormula } from '../backend/models/index.ts';

// Ids creados por estos tests, para limpieza determinista al final.
const createdFormulaIds = new Set<string>();
const createdApprovedIds = new Set<string>();

const CAT_APPROVED = '__test_formula__';
const CAT_PENDING = '__test_formula_pending__';

after(() => {
  for (const id of createdFormulaIds) formulasRepo.delete(id);
  for (const id of createdApprovedIds) approvedFormulasRepo.delete(id);
});

// ---------------------------------------------------------------------------
// Test 11 — generateFormula deja review_status "pending_review".
// ---------------------------------------------------------------------------
test('11 generateFormula deja review_status "pending_review"', () => {
  const f = generateFormula({ service_category: CAT_PENDING, created_by: 'tester' });
  assert.equal(f.review_status, 'pending_review', 'toda fórmula generada nace pendiente (R6)');
  assert.equal(f.approved_by, null);
  assert.equal(f.approved_at, null);

  // Aunque se persista, sigue pendiente.
  const saved = generateAndSaveFormula({ service_category: CAT_PENDING, created_by: 'tester' });
  createdFormulaIds.add(saved.id);
  const reread = formulasRepo.get(saved.id);
  assert.ok(reread, 'la fórmula persistida existe');
  assert.equal(reread!.review_status, 'pending_review');
});

// ---------------------------------------------------------------------------
// Test 12 — Sólo fórmulas approved se usan en la calculadora.
//   Una approved para "__test_formula__" se encuentra; una pending NO.
// ---------------------------------------------------------------------------
test('12 sólo fórmulas approved son encontradas por findApprovedFormula', () => {
  // a) Fórmula APROBADA para CAT_APPROVED (vía approveFormula -> copia a approvedFormulasRepo).
  const gen = generateAndSaveFormula({ service_category: CAT_APPROVED, created_by: 'tester' });
  createdFormulaIds.add(gen.id);
  const res = formulaReview.approveFormula(gen.id, 'revisor_interno');
  assert.equal(res.ok, true, `approveFormula debe tener éxito; faltan: ${JSON.stringify(res.missing)}`);
  createdApprovedIds.add(gen.id);

  const found = findApprovedFormula(CAT_APPROVED);
  assert.ok(found, 'la fórmula aprobada debe encontrarse para su categoría');
  assert.equal(found!.id, gen.id);
  assert.equal(found!.review_status, 'approved');

  // b) Fórmula PENDIENTE para CAT_PENDING: NO debe encontrarse (no está aprobada).
  const pending = generateAndSaveFormula({ service_category: CAT_PENDING, created_by: 'tester' });
  createdFormulaIds.add(pending.id);
  const notFound = findApprovedFormula(CAT_PENDING);
  assert.equal(notFound, null, 'una fórmula pendiente NO debe usarse en la calculadora');
});

// ---------------------------------------------------------------------------
// Test 13 — No se puede aprobar una fórmula sin variables ni assumptions.
// ---------------------------------------------------------------------------
test('13 canApprove/approveFormula devuelven missing sin variables ni assumptions', () => {
  const f = generateFormula({ service_category: CAT_PENDING, created_by: 'tester' });
  // Vaciamos variables y assumptions para forzar el fallo de validación (R13).
  const broken: PricingFormula = { ...f, variables: [], assumptions: [] };
  formulasRepo.save(broken);
  createdFormulaIds.add(broken.id);

  const check = formulaReview.canApprove(broken);
  assert.equal(check.ok, false, 'no debe ser aprobable sin variables ni assumptions');
  assert.ok(check.missing.includes('variables'), 'reporta variables como faltante');
  assert.ok(check.missing.includes('assumptions'), 'reporta assumptions como faltante');

  const res = formulaReview.approveFormula(broken.id, 'revisor_interno');
  assert.equal(res.ok, false, 'approveFormula debe rechazar la aprobación');
  assert.ok(Array.isArray(res.missing) && res.missing!.length > 0, 'devuelve la lista de faltantes');
  assert.ok(res.missing!.includes('variables'));
  assert.ok(res.missing!.includes('assumptions'));

  // No debe haberse copiado a approvedFormulasRepo.
  assert.equal(approvedFormulasRepo.get(broken.id), null, 'no se copia a aprobadas si falla la validación');
});

// ---------------------------------------------------------------------------
// Test 14 — La fórmula puede usar base_hourly_rate=250 con pocos/ningún registro.
//   La expression/assumptions referencian 250 y la confianza es low/medium.
// ---------------------------------------------------------------------------
test('14 con pocos/ningún registro la fórmula referencia la tarifa base 250 y confianza low/medium', () => {
  // CAT_PENDING no tiene registros aprobados -> ruta de tarifa base (R2/R11).
  const f = generateFormula({ service_category: CAT_PENDING, created_by: 'tester' });

  const base = String(BASE_HOURLY_RATE); // "250"
  assert.ok(
    f.formula_expression.includes(base),
    `la expresión debe referenciar la tarifa base ${base}; expr="${f.formula_expression}"`,
  );

  const assumptionsText = f.assumptions.join(' ').toLowerCase();
  assert.ok(
    assumptionsText.includes('tarifa base') || assumptionsText.includes(base),
    'alguna assumption debe justificar el uso de la tarifa base',
  );

  assert.ok(
    f.confidence_level === 'low' || f.confidence_level === 'medium',
    `sin histórico la confianza debe ser low|medium, fue "${f.confidence_level}"`,
  );

  // Sin registros aprobados, based_on_record_ids queda vacío, pero la assumption
  // de tarifa base permite que sea aprobable (R13).
  assert.equal(f.based_on_record_ids.length, 0, 'no hay registros aprobados que respalden');
  const check = formulaReview.canApprove(f);
  assert.equal(check.ok, true, `debe ser aprobable vía justificación de tarifa base; faltan: ${JSON.stringify(check.missing)}`);
});
