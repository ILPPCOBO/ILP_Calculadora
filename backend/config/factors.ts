/**
 * Configuración central de tarifa base y factores de cálculo.
 *
 * REGLA 2: la tarifa base por defecto es 250 €/hora. Este es el ÚNICO punto de
 * verdad: cualquier módulo que necesite la tarifa base debe importarla de aquí.
 *
 * REGLA 16: estos factores deben poder ajustarse. Por eso se cargan desde
 * data/service_categories/_config.json si existe, con fallback a estos valores
 * por defecto. La calculadora también admite override por petición.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'data', 'service_categories', '_config.json');

/** Tarifa base por defecto en EUR/hora (regla 2). */
export const BASE_HOURLY_RATE = 250;

/** Moneda por defecto del sistema. */
export const DEFAULT_CURRENCY = 'EUR';

export interface PricingConfig {
  base_hourly_rate: number;
  currency: string;
  complexity_factor: { low: number; medium: number; high: number; unknown: number };
  urgency_factor: { normal: number; urgent: number; very_urgent: number; unknown: number };
  /** Variación ±% aplicada al recomendado cuando NO hay histórico suficiente. */
  range_spread_no_history: number; // 0.15 => ±15%
}

/** Valores por defecto de los factores (regla: ajustables desde configuración). */
export const DEFAULT_CONFIG: PricingConfig = {
  base_hourly_rate: BASE_HOURLY_RATE,
  currency: DEFAULT_CURRENCY,
  complexity_factor: { low: 0.85, medium: 1.0, high: 1.3, unknown: 1.0 },
  urgency_factor: { normal: 1.0, urgent: 1.2, very_urgent: 1.4, unknown: 1.0 },
  range_spread_no_history: 0.15,
};

/**
 * Devuelve la configuración efectiva. Lee overrides de disco si existen
 * (data/service_categories/_config.json) y los fusiona sobre los valores por
 * defecto. Nunca falla: ante error de lectura/parse usa los valores por defecto.
 */
export function loadConfig(): PricingConfig {
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<PricingConfig>;
    return {
      base_hourly_rate: raw.base_hourly_rate ?? DEFAULT_CONFIG.base_hourly_rate,
      currency: raw.currency ?? DEFAULT_CONFIG.currency,
      complexity_factor: { ...DEFAULT_CONFIG.complexity_factor, ...(raw.complexity_factor ?? {}) },
      urgency_factor: { ...DEFAULT_CONFIG.urgency_factor, ...(raw.urgency_factor ?? {}) },
      range_spread_no_history: raw.range_spread_no_history ?? DEFAULT_CONFIG.range_spread_no_history,
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/** Factor de descuento: 1 - (porcentaje/100). discount=0|null => 1.0 (sin descuento). */
export function discountFactor(discountPercentage: number | null | undefined): number {
  if (!discountPercentage || discountPercentage <= 0) return 1.0;
  const pct = Math.min(discountPercentage, 100);
  return 1 - pct / 100;
}
