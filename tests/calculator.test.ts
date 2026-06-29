/**
 * Tests 15-26 — CALCULADORA (services/feeCalculator.ts).
 *
 * Aislamiento: categoría dedicada "__test_calc__" SIN fórmula aprobada ni
 * registros aprobados, para forzar SIEMPRE la ruta de tarifa base determinista.
 * Esto vuelve la aritmética predecible:
 *   recommended = estimated_hours * base_rate(250) * complexity_factor *
 *                 urgency_factor * discount_factor
 * Factores por defecto (DEFAULT_CONFIG, sin _config.json):
 *   complejidad: low 0.85, medium 1.0, high 1.3
 *   urgencia:    normal 1.0, urgent 1.2, very_urgent 1.4
 *   descuento d% -> 1 - d/100
 *
 * Limpieza: el único dato que persiste es el del test 24 (saveCalculation),
 * que se borra por id en finally.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateFee, saveCalculation } from '../services/feeCalculator.ts';
import type { CalcInput } from '../services/feeCalculator.ts';
import { calculationsRepo } from '../backend/storage/index.ts';

const CAT = '__test_calc__'; // sin fórmula aprobada ni registros -> ruta tarifa base.

/** Input base reutilizable; los tests sobreescriben lo que necesiten. */
function input(overrides: Partial<CalcInput> = {}): CalcInput {
  return {
    service_category: CAT,
    estimated_hours: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 15 — hourly_rate vacío => usa 250 (breakdown.used_base_rate true).
// ---------------------------------------------------------------------------
test('15 hourly_rate vacío usa la tarifa base 250', () => {
  const out = calculateFee(input({ hourly_rate: null }));
  assert.equal(out.breakdown.used_base_rate, true);
  assert.equal(out.breakdown.effective_hourly_rate, 250);
});

// ---------------------------------------------------------------------------
// Test 16 — estimated_hours=10, sin factores extra => recommended === 2500.
// ---------------------------------------------------------------------------
test('16 10h sin factores extra => 2500', () => {
  const out = calculateFee(input({ estimated_hours: 10 }));
  // 10 * 250 * 1.0 * 1.0 * 1.0 = 2500
  assert.equal(out.calculated_recommended, 2500);
});

// ---------------------------------------------------------------------------
// Test 17 — complexity "high" => factor 1.30 (10h => 3250).
// ---------------------------------------------------------------------------
test('17 complejidad high => factor 1.30 (10h => 3250)', () => {
  const out = calculateFee(input({ estimated_hours: 10, complexity_level: 'high' }));
  assert.equal(out.breakdown.complexity_factor, 1.3);
  // 10 * 250 * 1.3 = 3250
  assert.equal(out.calculated_recommended, 3250);
});

// ---------------------------------------------------------------------------
// Test 18 — urgency "urgent" => factor 1.20 (10h => 3000).
// ---------------------------------------------------------------------------
test('18 urgencia urgent => factor 1.20 (10h => 3000)', () => {
  const out = calculateFee(input({ estimated_hours: 10, urgency_level: 'urgent' }));
  assert.equal(out.breakdown.urgency_factor, 1.2);
  // 10 * 250 * 1.2 = 3000
  assert.equal(out.calculated_recommended, 3000);
});

// ---------------------------------------------------------------------------
// Test 19 — descuento 10 => discount_factor 0.9 (10h => 2250).
// ---------------------------------------------------------------------------
test('19 descuento 10% => factor 0.9 (10h => 2250)', () => {
  const out = calculateFee(input({ estimated_hours: 10, discount_percentage: 10 }));
  assert.equal(out.breakdown.discount_factor, 0.9);
  // 10 * 250 * 0.9 = 2250
  assert.equal(out.calculated_recommended, 2250);
});

// ---------------------------------------------------------------------------
// Test 20 — devuelve min, recommended y max (no null).
// ---------------------------------------------------------------------------
test('20 devuelve calculated_min/recommended/max no nulos', () => {
  const out = calculateFee(input());
  assert.equal(typeof out.calculated_min, 'number');
  assert.equal(typeof out.calculated_recommended, 'number');
  assert.equal(typeof out.calculated_max, 'number');
  assert.ok(out.calculated_min! <= out.calculated_recommended!);
  assert.ok(out.calculated_recommended! <= out.calculated_max!);
});

// ---------------------------------------------------------------------------
// Test 21 — formula_used presente (string).
// ---------------------------------------------------------------------------
test('21 formula_used presente como string', () => {
  const out = calculateFee(input());
  assert.equal(typeof out.formula_used, 'string');
  assert.ok(out.formula_used.length > 0);
});

// ---------------------------------------------------------------------------
// Test 22 — explanation presente (no vacía).
// ---------------------------------------------------------------------------
test('22 explanation presente y no vacía', () => {
  const out = calculateFee(input());
  assert.equal(typeof out.explanation, 'string');
  assert.ok(out.explanation.trim().length > 0);
});

// ---------------------------------------------------------------------------
// Test 23 — confidence_level es low|medium|high (sin fórmula => "low").
// ---------------------------------------------------------------------------
test('23 confidence_level válido; sin fórmula => low', () => {
  const out = calculateFee(input());
  assert.ok(['low', 'medium', 'high'].includes(out.confidence_level));
  assert.equal(out.confidence_level, 'low');
});

// ---------------------------------------------------------------------------
// Test 24 — saveCalculation guarda en historial; LIMPIA después.
// ---------------------------------------------------------------------------
test('24 saveCalculation persiste en el historial', () => {
  const { record } = saveCalculation(input(), 'tester');
  try {
    const stored = calculationsRepo.get(record.id);
    assert.ok(stored, 'el cálculo debe existir en el historial');
    assert.equal(stored!.id, record.id);
    assert.equal(stored!.service_category, CAT);
  } finally {
    calculationsRepo.delete(record.id); // limpieza determinista.
  }
});

// ---------------------------------------------------------------------------
// Test 25 — sin histórico => usa tarifa base con warning.
// ---------------------------------------------------------------------------
test('25 sin histórico usa tarifa base y avisa', () => {
  const out = calculateFee(input());
  assert.equal(out.breakdown.used_base_rate, true);
  assert.ok(
    out.warnings.some((w) => w.includes('Cálculo basado en tarifa base')),
    `debe incluir el warning de tarifa base; warnings=${JSON.stringify(out.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 26 — sin estimated_hours => needs_input true y min/recommended/max null.
// ---------------------------------------------------------------------------
test('26 sin estimated_hours => needs_input y sin números', () => {
  const out = calculateFee(input({ estimated_hours: null }));
  assert.equal(out.needs_input, true);
  assert.equal(out.calculated_min, null);
  assert.equal(out.calculated_recommended, null);
  assert.equal(out.calculated_max, null);
});
