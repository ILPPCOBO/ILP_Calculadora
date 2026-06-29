/**
 * documentUploadService — recepción y persistencia de documentos subidos.
 *
 * Flujo:
 *  1. Genera un id con newId('doc').
 *  2. Guarda el binario en data/uploaded_documents/<id>.<ext> (trazabilidad, R8).
 *  3. Lanza la extracción de texto/tablas vía extractFromBuffer.
 *  4. Construye un UploadedDocument completo y lo persiste con documentsRepo.save.
 *
 * El binario se guarda junto a los .json de metadatos del repositorio (misma
 * carpeta data/uploaded_documents), pero con extensión del archivo original, de
 * modo que NO colisiona con los <id>.json del JsonRepository.
 *
 * Tipos: se IMPORTAN de backend/models. No se redefinen.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';

import { documentsRepo, recordsRepo, DATA_ROOT } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { extractFromBuffer } from './documentTextExtractor.ts';
import type {
  UploadedDocument,
  DocumentType,
  ExtractionMethod,
} from '../backend/models/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Raíz del proyecto (un nivel por encima de /services). */
const PROJECT_ROOT = join(__dirname, '..');
/** Carpeta donde se guardan los binarios subidos. */
const UPLOAD_DIR = join(DATA_ROOT, 'uploaded_documents');

export interface UploadInput {
  filename: string;
  fileType: string;
  documentType: DocumentType;
  uploadedBy: string;
  content: Buffer;
}

/** Deriva una extensión limpia para el binario almacenado. */
function resolveExtension(fileType: string, filename: string): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/^\./, '');
  // Preferimos la extensión del nombre original si la trae.
  const dot = filename.lastIndexOf('.');
  if (dot >= 0 && dot < filename.length - 1) {
    const ext = clean(filename.slice(dot + 1));
    if (/^[a-z0-9]+$/.test(ext)) return ext;
  }
  const ft = clean(fileType);
  if (/^[a-z0-9]+$/.test(ft)) return ft;
  return 'bin';
}

/**
 * Guarda el binario, ejecuta la extracción y persiste el UploadedDocument.
 */
export async function uploadDocument(input: UploadInput): Promise<UploadedDocument> {
  const id = newId('doc');
  const ext = resolveExtension(input.fileType, input.filename);

  // 1) Persistir el binario en disco (trazabilidad).
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
  const absStoredPath = join(UPLOAD_DIR, `${id}.${ext}`);
  writeFileSync(absStoredPath, input.content);
  // Ruta relativa a la raíz del proyecto para guardar en el modelo.
  const storedPath = relative(PROJECT_ROOT, absStoredPath);

  // 2) Extracción (nunca lanza por dependencias opcionales ausentes).
  const extraction = await extractFromBuffer(input.content, input.fileType, input.filename);

  // 3) Construir el UploadedDocument completo.
  const method: ExtractionMethod | null = extraction.method ?? null;
  const doc: UploadedDocument = {
    id,
    original_filename: input.filename,
    file_type: ext,
    uploaded_at: nowIso(),
    uploaded_by: input.uploadedBy,
    document_type: input.documentType,
    extraction_status: extraction.status,
    extraction_method: method,
    extracted_text: extraction.text,
    extracted_tables: extraction.tables,
    warnings: extraction.warnings,
    source_locations: extraction.source_locations,
    confidence_level: extraction.confidence_level,
    stored_path: storedPath,
  };

  // 4) Persistir metadatos vía repositorio.
  documentsRepo.save(doc);
  return doc;
}

/** Lista todos los documentos subidos. */
export function listDocuments(): UploadedDocument[] {
  return documentsRepo.list();
}

/** Obtiene un documento por id, o null si no existe. */
export function getDocument(id: string): UploadedDocument | null {
  return documentsRepo.get(id);
}

export interface DeleteDocumentResult {
  deleted: boolean;
  /** true si NO se borró por haber registros aprobados y no usarse `force`. */
  blocked: boolean;
  reason: string | null;
  document_id: string;
  /** Registros derivados (extraídos de este documento) encontrados. */
  records_total: number;
  records_approved: number;
  /** Registros eliminados en cascada (0 si blocked). */
  records_deleted: number;
  binary_deleted: boolean;
}

/**
 * Elimina un documento subido: su binario, sus metadatos y, en cascada, los
 * registros extraídos de él (para no dejar huérfanos que rompan la trazabilidad).
 *
 * SALVAGUARDA (R3/R8): si el documento tiene registros APROBADOS (que respaldan
 * referencias y fórmulas), NO se borra salvo que se pase `force: true`. Así una
 * eliminación accidental no altera precios aprobados sin confirmación explícita.
 *
 * Devuelve null si el documento no existe (para que la ruta devuelva 404).
 */
export function deleteDocument(id: string, options: { force?: boolean } = {}): DeleteDocumentResult | null {
  const doc = documentsRepo.get(id);
  if (!doc) return null;

  const derived = recordsRepo.find((r) => r.document_id === id);
  const approved = derived.filter((r) => r.review_status === 'approved');

  if (approved.length > 0 && !options.force) {
    return {
      deleted: false,
      blocked: true,
      reason: `El documento tiene ${approved.length} registro(s) APROBADO(S) que respaldan referencias y fórmulas. Confirma la eliminación para borrarlos también.`,
      document_id: id,
      records_total: derived.length,
      records_approved: approved.length,
      records_deleted: 0,
      binary_deleted: false,
    };
  }

  // Cascada: eliminar los registros derivados (cualquier estado).
  for (const r of derived) recordsRepo.delete(r.id);

  // Eliminar el binario almacenado, si existe.
  let binaryDeleted = false;
  if (doc.stored_path) {
    const abs = join(PROJECT_ROOT, doc.stored_path);
    if (existsSync(abs)) {
      try { rmSync(abs); binaryDeleted = true; } catch { /* best-effort */ }
    }
  }

  documentsRepo.delete(id);

  return {
    deleted: true,
    blocked: false,
    reason: null,
    document_id: id,
    records_total: derived.length,
    records_approved: approved.length,
    records_deleted: derived.length,
    binary_deleted: binaryDeleted,
  };
}
