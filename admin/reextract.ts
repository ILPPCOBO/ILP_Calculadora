/**
 * admin/reextract.ts — Re-extrae registros de los documentos YA subidos usando el
 * extractor actual (mejorado para honorarios en prosa: igualas mensuales, cantidades
 * fijas, etc.). Útil tras mejorar el extractor sin volver a subir los documentos.
 *
 * SEGURO con tus datos:
 *  - NO toca los documentos (no se borra ni re-sube nada).
 *  - Documentos con registros ya APROBADOS se SALTAN (no se duplican ni se pierden).
 *  - Para el resto, borra sus registros auto-extraídos (pending/rejected) y re-extrae.
 *  - Los registros nuevos nacen en pending_review (R5).
 *
 * Uso:  export PATH="$HOME/.local/node/bin:$PATH"; node admin/reextract.ts
 */

import { documentsRepo, recordsRepo } from '../backend/storage/index.ts';
import { extractAndSaveRecords } from '../services/workRecordExtractor.ts';
import type { FeeType } from '../backend/models/index.ts';

async function main(): Promise<void> {
  const docs = documentsRepo.list();
  let processed = 0;
  let skipped = 0;
  let created = 0;
  const byFeeType: Partial<Record<FeeType, number>> = {};
  const byArea: Record<string, number> = {};

  console.log('====================================================');
  console.log(' RE-EXTRACCIÓN DE REGISTROS (extractor mejorado)');
  console.log(`  Documentos: ${docs.length}`);
  console.log('----------------------------------------------------');

  for (const doc of docs) {
    const derived = recordsRepo.find((r) => r.document_id === doc.id);
    const approved = derived.filter((r) => r.review_status === 'approved');
    if (approved.length > 0) {
      skipped += 1;
      continue; // no tocar documentos con registros aprobados
    }
    // Borra los registros auto-extraídos previos (no aprobados) de este documento.
    for (const r of derived) recordsRepo.delete(r.id);

    const recs = await extractAndSaveRecords(doc);
    processed += 1;
    created += recs.length;
    for (const r of recs) {
      byFeeType[r.fee_type] = (byFeeType[r.fee_type] ?? 0) + 1;
      byArea[r.service_category] = (byArea[r.service_category] ?? 0) + 1;
    }
    const tag = recs.length ? recs.map((r) => `${r.fee_type}:${r.total_fee ?? r.hourly_rate ?? '—'}`).join(', ') : 'sin registro';
    console.log(`  ✓ ${doc.original_filename}  → ${tag}`);
  }

  console.log('----------------------------------------------------');
  console.log(` Documentos re-extraídos ......... ${processed}`);
  console.log(` Documentos saltados (aprobados) . ${skipped}`);
  console.log(` Registros creados (pending) ..... ${created}`);
  console.log(` Por tipo de honorario: ${JSON.stringify(byFeeType)}`);
  console.log(' Por área:');
  for (const [a, n] of Object.entries(byArea).sort((x, y) => y[1] - x[1])) {
    console.log(`   - ${a}: ${n}`);
  }
  console.log('====================================================');
  console.log('Revisa y aprueba los registros en "Revisar registros" para que alimenten las referencias por área.');
}

main();
