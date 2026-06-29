/**
 * Baselines de horas típicas por área (SUPUESTOS editables, no datos históricos).
 *
 * Se usan SÓLO como último recurso, cuando no hay trabajos históricos aprobados
 * de los que aprender (ni horas ni precio). Reflejan rangos orientativos de un
 * encargo típico en cada área para que la estimación no sea absurda (p.ej. un
 * concurso ronda decenas de horas, no 4). Son ajustables y se marcan como
 * "supuesto del área" con confianza baja (R12: no se presentan como histórico real).
 *
 * Prioridad de estimación en caseEstimator:
 *   1) horas de trabajos aprobados del área (si existen)  -> lo más fiable
 *   2) precio de trabajos aprobados del área / tarifa      -> horas implícitas del precio
 *   3) este baseline del área                              -> supuesto orientativo
 */

export interface HourBaseline { min: number; rec: number; max: number; }

/** Baseline por defecto si el área no está en la tabla. */
export const DEFAULT_BASELINE: HourBaseline = { min: 6, rec: 14, max: 30 };

/**
 * Tabla de baselines. Las claves cubren tanto las áreas del desplegable de
 * "Describir caso" como las que detecta el clasificador (M&A, Concursal, etc.).
 */
export const AREA_BASELINES: Record<string, HourBaseline> = {
  // Áreas del desplegable de "Describir caso"
  'Marcas': { min: 4, rec: 8, max: 16 },
  'Propiedad intelectual': { min: 8, rec: 16, max: 30 },
  'Contratos mercantiles': { min: 8, rec: 16, max: 35 },
  'Constitución de sociedades': { min: 6, rec: 12, max: 25 },
  'Compliance': { min: 20, rec: 40, max: 80 },
  'Protección de datos': { min: 10, rec: 25, max: 50 },
  'Litigios': { min: 30, rec: 60, max: 120 },
  'Due diligence': { min: 25, rec: 50, max: 100 },
  'Consultoría regulatoria': { min: 15, rec: 35, max: 70 },
  'Laboral': { min: 8, rec: 20, max: 45 },
  'Fiscal': { min: 8, rec: 20, max: 45 },
  'Revisión documental': { min: 4, rec: 10, max: 20 },
  'Redacción de informes': { min: 4, rec: 10, max: 20 },
  'Otros': { min: 6, rec: 14, max: 30 },

  // Áreas reales de ILP que detecta el clasificador
  'M&A': { min: 60, rec: 120, max: 250 },
  'Concursal': { min: 40, rec: 70, max: 130 },
  'Reestructuraciones': { min: 40, rec: 80, max: 150 },
  'Startups': { min: 10, rec: 25, max: 50 },
  'Energías renovables': { min: 30, rec: 60, max: 120 },
  'Procesal civil': { min: 30, rec: 60, max: 120 },
  'Procesal penal': { min: 40, rec: 80, max: 150 },
  'Asesoramiento corporativo': { min: 8, rec: 16, max: 35 },
  'Regulatorio financiero': { min: 20, rec: 45, max: 90 },
  'Secretarías de consejo': { min: 6, rec: 14, max: 30 },
};

export function getAreaBaseline(area: string | null | undefined): HourBaseline {
  if (!area) return DEFAULT_BASELINE;
  return AREA_BASELINES[area] ?? DEFAULT_BASELINE;
}
