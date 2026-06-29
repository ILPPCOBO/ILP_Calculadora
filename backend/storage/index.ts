/**
 * Repositorios tipados de la aplicación. Punto único de acceso a datos.
 *
 * Cada repositorio apunta a su carpeta en /data según la estructura pedida.
 * Para migrar a una base de datos real basta con reemplazar `JsonRepository`
 * por otra implementación de `Repository<T>` aquí, sin tocar los servicios.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JsonRepository } from './repository.ts';
import type {
  UploadedDocument, ExtractedWorkRecord, ServiceCategory, PricingFormula, FeeCalculation,
  PlannedActionBreakdown, ExportedBreakdownDocument,
} from '../models/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = join(__dirname, '..', '..', 'data');

const dataDir = (sub: string) => join(DATA_ROOT, sub);

/** Documentos históricos subidos (metadatos + texto/tablas extraídas). */
export const documentsRepo = new JsonRepository<UploadedDocument>(dataDir('uploaded_documents'));

/** Registros de trabajo extraídos de los documentos. */
export const recordsRepo = new JsonRepository<ExtractedWorkRecord>(dataDir('extracted_records'));

/** Categorías de servicio. */
export const categoriesRepo = new JsonRepository<ServiceCategory>(dataDir('service_categories'));

/** Fórmulas sugeridas (pendientes o rechazadas). */
export const formulasRepo = new JsonRepository<PricingFormula>(dataDir('pricing_formulas'));

/** Fórmulas aprobadas (copia usable por la calculadora — sólo approved). */
export const approvedFormulasRepo = new JsonRepository<PricingFormula>(dataDir('approved_formulas'));

/** Historial de cálculos. */
export const calculationsRepo = new JsonRepository<FeeCalculation>(dataDir('calculation_history'));

/** Desgloses de actuaciones previstas (cada uno embebe sus PlannedAction). */
export const breakdownsRepo = new JsonRepository<PlannedActionBreakdown>(dataDir('planned_action_breakdowns'));

/** Documentos .docx generados a partir de un desglose (metadatos + ruta). */
export const exportedDocsRepo = new JsonRepository<ExportedBreakdownDocument>(dataDir('exported_breakdown_documents'));

export const repos = {
  documents: documentsRepo,
  records: recordsRepo,
  categories: categoriesRepo,
  formulas: formulasRepo,
  approvedFormulas: approvedFormulasRepo,
  calculations: calculationsRepo,
  breakdowns: breakdownsRepo,
  exportedDocs: exportedDocsRepo,
};
