/**
 * batchImport — importación MASIVA de acuerdos históricos desde una carpeta local.
 *
 * Pensado para cargar de golpe cientos de documentos (facturas, presupuestos,
 * cartas de encargo, contratos, hojas de horas…). Recorre un directorio, sube
 * cada archivo soportado vía documentUploadService (que extrae texto/tablas) y,
 * opcionalmente, extrae los ExtractedWorkRecord (que nacen en pending_review).
 *
 * Todo es 100% LOCAL: ningún dato sale de la máquina. Procesa de forma secuencial
 * para no saturar memoria con lotes grandes y para dar progreso fiable.
 *
 * Reglas: R5 (los registros nacen pending_review), R8 (trazabilidad: cada doc
 * conserva su binario y source_locations), R12 (degradación elegante: un escaneado
 * sin OCR se marca manual_review_needed con warning, no se inventa contenido).
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { uploadDocument } from './documentUploadService.ts';
import { extractAndSaveRecords } from './workRecordExtractor.ts';
import type { DocumentType } from '../backend/models/index.ts';

/** Extensiones soportadas (deben coincidir con documentTextExtractor). */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.msg', '.eml'];

export interface ImportOptions {
  /** Carpeta a importar (ruta absoluta recomendada). */
  dir: string;
  /** Autor de la carga (queda en cada documento). */
  uploadedBy: string;
  /** Forzar un tipo de documento para todos; si se omite, se infiere por nombre. */
  documentType?: DocumentType;
  /** Si true (por defecto), tras subir cada doc extrae sus registros (pending_review). */
  extractRecords?: boolean;
  /** Recorrer subcarpetas (por defecto true). */
  recursive?: boolean;
  /** Límite opcional de archivos (útil para pruebas). */
  limit?: number;
}

export interface ImportFileResult {
  file: string;            // ruta relativa al dir importado
  ok: boolean;
  document_id?: string;
  document_type?: DocumentType;
  extraction_method?: string | null;
  records_extracted?: number;
  needs_manual_review?: boolean; // p.ej. escaneado sin OCR
  warnings?: string[];
  error?: string;
}

export interface ImportResult {
  dir: string;
  files_total: number;        // archivos soportados encontrados
  files_skipped: number;      // archivos con extensión no soportada
  imported: number;
  failed: number;
  records_extracted: number;
  needs_manual_review: number; // documentos que requieren revisión/OCR manual
  details: ImportFileResult[];
}

/** Infiere el DocumentType a partir del nombre del archivo (heurística en es/en). */
export function guessDocumentType(filename: string): DocumentType {
  const n = filename.toLowerCase();
  const ext = extname(n);
  if (/(factura|invoice)/.test(n)) return 'invoice';
  if (/(presupuesto|propuesta|proposal|oferta|quote)/.test(n)) return 'proposal';
  if (/(encargo|engagement|hoja de encargo|carta de encargo)/.test(n)) return 'engagement_letter';
  if (/(timesheet|horas|imputacion|dedicacion)/.test(n)) return 'timesheet';
  if (/(contrato|acuerdo|agreement|contract|convenio)/.test(n)) return 'contract';
  if (/(email|correo|mail)/.test(n) || ext === '.msg' || ext === '.eml') return 'email';
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') return 'spreadsheet';
  return 'other';
}

/** Recorre un directorio devolviendo rutas de archivos (recursivo opcional). */
function walk(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue; // ignora ocultos (.DS_Store, etc.)
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (recursive) out.push(...walk(full, recursive));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Importa todos los documentos soportados de un directorio. Devuelve un resumen
 * con detalle por archivo. No lanza ante un archivo fallido: lo marca y continúa.
 *
 * `onProgress` (opcional) se invoca tras cada archivo para mostrar avance.
 */
export async function importFromDirectory(
  opts: ImportOptions,
  onProgress?: (done: number, total: number, last: ImportFileResult) => void,
): Promise<ImportResult> {
  const recursive = opts.recursive ?? true;
  const extractRecords = opts.extractRecords ?? true;

  const all = walk(opts.dir, recursive);
  // Salta versiones obsoletas/duplicadas evidentes por el nombre (reduce ruido).
  const OBSOLETE = /obsolet|repetida|repetido|no tener en cuenta|es la misma|misma que|misma anterior/i;
  const supported = all.filter((f) => SUPPORTED_EXTENSIONS.includes(extname(f).toLowerCase()) && !OBSOLETE.test(basename(f)));
  const skipped = all.length - supported.length;
  const selected = typeof opts.limit === 'number' ? supported.slice(0, opts.limit) : supported;

  const result: ImportResult = {
    dir: opts.dir,
    files_total: supported.length,
    files_skipped: skipped,
    imported: 0,
    failed: 0,
    records_extracted: 0,
    needs_manual_review: 0,
    details: [],
  };

  let done = 0;
  for (const filePath of selected) {
    const rel = filePath.startsWith(opts.dir) ? filePath.slice(opts.dir.length).replace(/^[/\\]/, '') : filePath;
    const ext = extname(filePath).toLowerCase().replace('.', '');
    const docType = opts.documentType ?? guessDocumentType(basename(filePath));

    const fileResult: ImportFileResult = { file: rel, ok: false };
    try {
      const content = readFileSync(filePath);
      const doc = await uploadDocument({
        filename: basename(filePath),
        fileType: ext,
        documentType: docType,
        uploadedBy: opts.uploadedBy,
        content,
      });

      fileResult.ok = true;
      fileResult.document_id = doc.id;
      fileResult.document_type = docType;
      fileResult.extraction_method = doc.extraction_method;
      fileResult.warnings = doc.warnings;
      const needsReview = doc.extraction_method === 'manual_review_needed' || doc.extraction_status === 'failed';
      fileResult.needs_manual_review = needsReview;
      result.imported += 1;
      if (needsReview) result.needs_manual_review += 1;

      if (extractRecords && doc.extraction_status === 'completed') {
        const recs = await extractAndSaveRecords(doc);
        fileResult.records_extracted = recs.length;
        result.records_extracted += recs.length;
      } else {
        fileResult.records_extracted = 0;
      }
    } catch (err) {
      fileResult.ok = false;
      fileResult.error = err instanceof Error ? err.message : String(err);
      result.failed += 1;
    }

    result.details.push(fileResult);
    done += 1;
    if (onProgress) onProgress(done, selected.length, fileResult);
  }

  return result;
}
