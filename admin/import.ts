/**
 * admin/import.ts — Importación MASIVA de acuerdos históricos desde una carpeta.
 *
 * Uso:
 *   export PATH="$HOME/.local/node/bin:$PATH"
 *   node admin/import.ts [carpeta] [autor]
 *
 *   - [carpeta]: ruta a importar. Por defecto: data/inbox (suelta ahí tus archivos).
 *   - [autor]:   queda registrado en cada documento. Por defecto: "import_cli".
 *
 * Procesa PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, JPEG. Los escaneados/imagen sin OCR
 * se marcan para revisión manual (no se inventa contenido). Todo es 100% local.
 *
 * Tras importar, revisa los registros en la pantalla "Revisar registros" y
 * apruébalos: sólo los aprobados alimentan referencias y fórmulas.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { importFromDirectory } from '../services/batchImport.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DEFAULT_DIR = join(PROJECT_ROOT, 'data', 'inbox');

async function main(): Promise<void> {
  const dirArg = process.argv[2];
  const author = process.argv[3] ?? 'import_cli';
  const dir = dirArg ? resolve(dirArg) : DEFAULT_DIR;

  if (!existsSync(dir)) {
    if (dir === DEFAULT_DIR) {
      mkdirSync(dir, { recursive: true });
      console.log(`Carpeta por defecto creada: ${dir}`);
      console.log('Suelta ahí tus documentos y vuelve a ejecutar:  node admin/import.ts');
      return;
    }
    console.error(`La carpeta no existe: ${dir}`);
    process.exit(1);
  }

  console.log('====================================================');
  console.log(' IMPORTACIÓN MASIVA DE ACUERDOS HISTÓRICOS');
  console.log(`  Carpeta: ${dir}`);
  console.log(`  Autor:   ${author}`);
  console.log('  (procesamiento 100% local; puede tardar con muchos archivos)');
  console.log('----------------------------------------------------');

  const result = await importFromDirectory(
    { dir, uploadedBy: author, extractRecords: true, recursive: true },
    (done, total, last) => {
      const tag = last.ok ? (last.needs_manual_review ? '⚠ revisar' : '✓') : '✗ error';
      console.log(`  [${done}/${total}] ${tag}  ${last.file}`
        + (last.records_extracted ? `  (+${last.records_extracted} registro/s)` : '')
        + (last.error ? `  — ${last.error}` : ''));
    },
  );

  console.log('----------------------------------------------------');
  console.log(` Archivos soportados encontrados . ${result.files_total}`);
  console.log(` Ignorados (formato no soportado)  ${result.files_skipped}`);
  console.log(` Importados ...................... ${result.imported}`);
  console.log(` Fallidos ........................ ${result.failed}`);
  console.log(` Registros extraídos (pending) ... ${result.records_extracted}`);
  console.log(` Requieren revisión manual / OCR . ${result.needs_manual_review}`);
  console.log('====================================================');
  if (result.needs_manual_review > 0) {
    console.log('Nota: hay documentos escaneados/imagen. Para extraer su texto instala OCR:');
    console.log('      npm install tesseract.js   (el extractor lo detecta automáticamente)');
  }
  console.log('Siguiente paso: revisa y aprueba los registros en la pantalla "Revisar registros".');
}

main();
