/**
 * Tests 27-29 — INTERFAZ (a nivel lógico, SIN levantar servidor).
 *
 * Verifican las garantías que la UI debe reflejar:
 *  - R2: la tarifa base del sistema es 250 (constante y configuración efectiva).
 *  - R9/R18: la calculadora indica claramente cuándo usa la tarifa base.
 *  - R17: el historial guarda los cálculos.
 *
 * Aislamiento: categoría dedicada "__test_iface__" (sin fórmula aprobada ni
 * registros) y limpieza por id de cualquier cálculo persistido.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASE_HOURLY_RATE, loadConfig } from '../backend/config/factors.ts';
import { calculateFee, saveCalculation } from '../services/feeCalculator.ts';
import type { CalcInput } from '../services/feeCalculator.ts';
import { calculationsRepo } from '../backend/storage/index.ts';

const CAT = '__test_iface__';

function input(overrides: Partial<CalcInput> = {}): CalcInput {
  return {
    service_category: CAT,
    estimated_hours: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 27 — La tarifa base del sistema es 250.
// ---------------------------------------------------------------------------
test('27 la tarifa base del sistema es 250', () => {
  assert.equal(BASE_HOURLY_RATE, 250, 'BASE_HOURLY_RATE === 250 (R2, único punto de verdad)');
  assert.equal(loadConfig().base_hourly_rate, 250, 'la configuración efectiva expone 250');
});

// ---------------------------------------------------------------------------
// Test 28 — La calculadora indica cuándo usa la tarifa base.
// ---------------------------------------------------------------------------
test('28 la calculadora marca el uso de la tarifa base', () => {
  const out = calculateFee(input({ hourly_rate: null }));
  assert.equal(out.breakdown.used_base_rate, true, 'breakdown.used_base_rate debe ser true');
  assert.ok(
    out.explanation.toLowerCase().includes('tarifa base'),
    `la explicación debe mencionar "tarifa base"; fue: "${out.explanation}"`,
  );
});

// ---------------------------------------------------------------------------
// Test 29 — El historial guarda los cálculos; LIMPIA después.
// ---------------------------------------------------------------------------
test('29 el historial persiste los cálculos', () => {
  const { record } = saveCalculation(input(), 'tester');
  try {
    const stored = calculationsRepo.get(record.id);
    assert.ok(stored, 'el cálculo debe aparecer vía calculationsRepo');
    assert.equal(stored!.id, record.id);
    // También debe aparecer al listar (lo que consumiría la pantalla Historial).
    assert.ok(
      calculationsRepo.find((c) => c.id === record.id).length === 1,
      'el cálculo debe ser localizable en el listado del historial',
    );
  } finally {
    calculationsRepo.delete(record.id); // limpieza determinista.
  }
});
