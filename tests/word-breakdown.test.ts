/**
 * Tests del exportador Word (wordBreakdownExporter). El .docx se genera con
 * método ZIP STORE (sin compresión), así que el XML viaja literal en el buffer
 * y podemos comprobar su contenido sin descomprimir. Verificamos estructura ZIP
 * válida y que el documento contiene todas las secciones del encargo.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { generateBreakdown } from '../services/plannedActionsBreakdown.ts';
import type { BreakdownInput } from '../services/plannedActionsBreakdown.ts';
import { exportBreakdownDocx, saveBreakdownDocx } from '../services/wordBreakdownExporter.ts';
import { DATA_ROOT, exportedDocsRepo } from '../backend/storage/index.ts';

function sample(): BreakdownInput {
  return {
    source_type: 'automatic_estimate',
    service_category: 'M&A',
    service_subcategory: 'Adquisiciones',
    description: 'Adquisición de una sociedad: due diligence, negociación y firma del SPA.',
    tasks: ['Due diligence legal', 'Negociar el SPA', 'Redactar contratos accesorios', 'Coordinación con el cliente', 'Organización del data room'],
    estimated_total_hours: 120,
    estimated_total_fee: 36000,
    rate_used: 300,
    complexity_level: 'high',
    urgency_level: 'urgent',
  };
}

const cleanup: string[] = [];
after(() => {
  for (const f of cleanup) { try { if (existsSync(f)) rmSync(f); } catch { /* noop */ } }
});

// 14. El Word se genera correctamente (ZIP válido).
test('14 genera un .docx con estructura ZIP válida', () => {
  const b = generateBreakdown(sample());
  const { fileName, buffer } = exportBreakdownDocx(b, { firmName: 'ILP Abogados' });
  assert.ok(fileName.endsWith('.docx'));
  assert.ok(buffer.length > 1000);
  // Firma local "PK\x03\x04" y fin de directorio central "PK\x05\x06".
  assert.equal(buffer[0], 0x50); assert.equal(buffer[1], 0x4b);
  assert.equal(buffer[2], 0x03); assert.equal(buffer[3], 0x04);
  assert.ok(buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'falta EOCD');
});

// 15. El Word contiene el resumen del mandato.
test('15 contiene el resumen del mandato', () => {
  const b = generateBreakdown(sample());
  const xml = exportBreakdownDocx(b, {}).buffer.toString('utf8');
  assert.ok(xml.includes('Desglose de actuaciones previstas'));
  assert.ok(xml.includes('Mandato:'));
  assert.ok(xml.includes('1. Resumen del mandato'));
  assert.ok(xml.includes('M&amp;A') || xml.includes('M&A'));
});

// 16. El Word contiene la tabla de actuaciones (cabeceras).
test('16 contiene la tabla de actuaciones', () => {
  const b = generateBreakdown(sample());
  const xml = exportBreakdownDocx(b, {}).buffer.toString('utf8');
  for (const head of ['Actuación prevista', 'Aportación de valor', 'Horas estimadas', 'Perfil responsable', 'Entregable']) {
    assert.ok(xml.includes(head), `falta cabecera: ${head}`);
  }
});

// 17. El Word contiene la distribución de aportación de valor.
test('17 contiene la distribución de aportación de valor', () => {
  const b = generateBreakdown(sample());
  const xml = exportBreakdownDocx(b, {}).buffer.toString('utf8');
  assert.ok(xml.includes('3. Distribución de aportación de valor'));
  assert.ok(xml.includes('Aportación alta de valor'));
  assert.ok(xml.includes('Aportación media de valor'));
  assert.ok(xml.includes('Aportación baja de valor'));
});

// 18. El Word contiene supuestos e información pendiente.
test('18 contiene supuestos y missing_information', () => {
  const b = generateBreakdown(sample());
  const xml = exportBreakdownDocx(b, {}).buffer.toString('utf8');
  assert.ok(xml.includes('4. Supuestos utilizados'));
  assert.ok(xml.includes('5. Información pendiente'));
});

// 19. El Word incluye la nota final de revisión interna.
test('19 incluye la nota final de revisión interna', () => {
  const b = generateBreakdown(sample());
  const xml = exportBreakdownDocx(b, {}).buffer.toString('utf8');
  assert.ok(xml.includes('6. Nota final'));
  assert.ok(xml.includes('revisado por el equipo jurídico'));
});

// Persistencia del documento exportado (ExportedBreakdownDocument + archivo).
test('19b saveBreakdownDocx escribe el archivo y registra el documento', () => {
  const b = generateBreakdown(sample());
  const { record, buffer } = saveBreakdownDocx(b, 'tester', { firmName: 'ILP Abogados' });
  const abs = join(DATA_ROOT, record.file_path);
  cleanup.push(abs);
  assert.ok(existsSync(abs), 'el .docx debería existir en disco');
  assert.equal(record.file_type, 'docx');
  assert.ok(record.id.startsWith('exp_'));
  assert.ok(buffer.length > 1000);
  assert.ok(exportedDocsRepo.get(record.id), 'debería existir el registro');
  // limpieza del registro
  exportedDocsRepo.delete(record.id);
});
