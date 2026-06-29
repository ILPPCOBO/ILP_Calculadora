/**
 * admin/reset.ts — Vacía TODOS los repositorios.
 *
 * Deja el estado de datos LIMPIO (necesario para los tests, que requieren un
 * estado vacío y determinista). No borra binarios fuera de los repos JSON.
 *
 * Uso:  export PATH="$HOME/.local/node/bin:$PATH"; node admin/reset.ts
 */

import {
  documentsRepo, recordsRepo, categoriesRepo,
  formulasRepo, approvedFormulasRepo, calculationsRepo,
} from '../backend/storage/index.ts';

interface RepoEntry {
  label: string;
  repo: { list(): unknown[]; clear(): void };
}

const REPOS: RepoEntry[] = [
  { label: 'uploaded_documents', repo: documentsRepo },
  { label: 'extracted_records', repo: recordsRepo },
  { label: 'service_categories', repo: categoriesRepo },
  { label: 'pricing_formulas', repo: formulasRepo },
  { label: 'approved_formulas', repo: approvedFormulasRepo },
  { label: 'calculation_history', repo: calculationsRepo },
];

function main(): void {
  console.log('====================================================');
  console.log(' RESET — vaciando todos los repositorios');
  console.log('----------------------------------------------------');

  let totalBorrados = 0;
  for (const { label, repo } of REPOS) {
    const before = repo.list().length;
    repo.clear();
    const after = repo.list().length;
    totalBorrados += before;
    console.log(` ${label.padEnd(22)} ${String(before).padStart(3)} -> ${after}`);
  }

  console.log('----------------------------------------------------');
  console.log(` Entidades borradas en total: ${totalBorrados}`);
  console.log(' Estado de datos LIMPIO (listo para tests).');
  console.log('====================================================');
}

main();
