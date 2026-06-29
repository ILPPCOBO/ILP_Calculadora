/* Tests de services/batchImport.ts — importación masiva por carpeta.
   Crea una carpeta temporal con archivos reales (TXT/CSV, sin dependencias),
   importa y limpia TODO lo creado (docs, registros, binarios y la carpeta). */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { importFromDirectory, guessDocumentType } from '../services/batchImport.ts';
import { documentsRepo, recordsRepo } from '../backend/storage/index.ts';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function cleanup(docIds: string[], dir: string): void {
  for (const id of docIds) {
    const doc = documentsRepo.get(id);
    if (doc && doc.stored_path) {
      const p = join(PROJECT_ROOT, doc.stored_path);
      if (existsSync(p)) { try { unlinkSync(p); } catch { /* noop */ } }
    }
    documentsRepo.delete(id);
    recordsRepo.find((r) => r.document_id === id).forEach((r) => recordsRepo.delete(r.id));
  }
  rmSync(dir, { recursive: true, force: true });
}

test('importFromDirectory: importa soportados, ignora el resto y extrae registros pending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imp-'));
  writeFileSync(join(dir, 'factura_test.txt'),
    'FACTURA\nCliente: Test SL\nServicio: Adquisicion\nHoras: 10\nTarifa: 250 EUR\nTotal: 2500 EUR\n');
  writeFileSync(join(dir, 'datos.csv'),
    'Cliente,Servicio,Horas,Importe,Moneda\nFoo SL,Ronda,5,1250,EUR\n');
  writeFileSync(join(dir, 'ignorar.zip'), 'formato no soportado');

  const docIds: string[] = [];
  try {
    const res = await importFromDirectory({ dir, uploadedBy: 'test', extractRecords: true });
    res.details.forEach((d) => { if (d.document_id) docIds.push(d.document_id); });

    assert.strictEqual(res.files_total, 2, 'txt + csv son soportados');
    assert.strictEqual(res.files_skipped, 1, 'el .zip se ignora');
    assert.strictEqual(res.imported, 2);
    assert.strictEqual(res.failed, 0);
    assert.ok(res.records_extracted >= 1, 'extrae al menos un registro');

    // Los registros extraídos nacen en pending_review (R5).
    for (const id of docIds) {
      const recs = recordsRepo.find((r) => r.document_id === id);
      assert.ok(recs.every((r) => r.review_status === 'pending_review'),
        'todos los registros importados quedan pendientes de revisión');
    }
    // Los documentos quedaron persistidos con trazabilidad (R8).
    assert.ok(docIds.every((id) => documentsRepo.get(id) !== null));
  } finally {
    cleanup(docIds, dir);
  }
});

test('guessDocumentType infiere el tipo por el nombre del archivo', () => {
  assert.strictEqual(guessDocumentType('factura_2024_acme.pdf'), 'invoice');
  assert.strictEqual(guessDocumentType('contrato_distribucion.docx'), 'contract');
  assert.strictEqual(guessDocumentType('presupuesto_marca.docx'), 'proposal');
  assert.strictEqual(guessDocumentType('timesheet_q1.xlsx'), 'timesheet');
  assert.strictEqual(guessDocumentType('export.csv'), 'spreadsheet');
  assert.strictEqual(guessDocumentType('cosa_rara.pdf'), 'other');
});

test('importFromDirectory: carpeta vacía => resumen en cero, sin error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imp-empty-'));
  try {
    const res = await importFromDirectory({ dir, uploadedBy: 'test' });
    assert.strictEqual(res.files_total, 0);
    assert.strictEqual(res.imported, 0);
    assert.strictEqual(res.records_extracted, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
