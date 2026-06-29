# PROJECT_RULES.md — Reglas maestras

> Estas reglas son la **constitución** de la Calculadora Inteligente de Honorarios.
> Todo módulo, servicio, fórmula y pantalla debe respetarlas. Si una decisión de
> implementación entra en conflicto con estas reglas, **gana la regla**.

1. La herramienta calcula **honorarios sugeridos**, no precios obligatorios.
2. La **tarifa base por defecto es 250 €/hora** (`base_hourly_rate = 250 EUR`).
3. La herramienta debe basarse en **documentos históricos, registros aprobados y fórmulas aprobadas**.
4. La IA puede **extraer datos y sugerir fórmulas, pero no aprobar automáticamente**.
5. Todo registro extraído automáticamente debe quedar como `review_status: "pending_review"`.
6. Toda fórmula generada automáticamente debe quedar como `review_status: "pending_review"`.
7. Solo un **usuario interno** puede aprobar registros y fórmulas.
8. Los documentos subidos deben conservar **trazabilidad**.
9. Cada cálculo debe mostrar **qué fórmula usó**.
10. Cada cálculo debe mostrar **qué datos históricos, registros o supuestos lo respaldan**.
11. Si no hay datos suficientes, la herramienta debe decir **"información insuficiente"**.
12. La herramienta **no debe inventar** precios históricos, clientes, horas, tarifas, servicios ni pagos.
13. La herramienta debe mostrar **rangos sugeridos** cuando sea posible: mínimo, recomendado y máximo.
14. La herramienta debe incluir **nivel de confianza**: bajo, medio o alto.
15. La herramienta debe permitir **revisión humana** de documentos, registros extraídos, categorías y fórmulas.
16. La herramienta debe permitir **ajustar manualmente** tarifa, horas, complejidad, urgencia y descuento.
17. La herramienta debe **guardar historial de cálculos**.
18. Toda recomendación debe explicarse de forma **clara y trazable**.

---

## Cómo se traducen estas reglas al código

| Regla | Garantía técnica |
|------|------------------|
| 2 | `backend/config/factors.ts` exporta `BASE_HOURLY_RATE = 250`. Único punto de verdad. |
| 4, 5, 6 | Los extractores y el generador de fórmulas **siempre** crean registros con `review_status: "pending_review"`. No existe ruta de auto-aprobación. |
| 7 | Sólo `recordReview.approveRecord()` / `formulaReview.approveFormula()` cambian el estado, y requieren `approved_by`. |
| 8 | `ExtractedWorkRecord.document_id` + `source_location` enlazan cada dato a su documento fuente. |
| 9, 10, 18 | `FeeCalculation` guarda `selected_formula_id` (o "tarifa base"), `explanation` y `comparable_record_ids`. |
| 11 | El cálculo devuelve `confidence_level: "low"` + warning "información insuficiente" cuando no hay histórico ni fórmula aprobada. |
| 12 | Los extractores devuelven `null` / `"unknown"` ante datos ausentes. Nunca rellenan con valores inventados. |
| 13 | Toda salida de cálculo incluye `calculated_min`, `calculated_recommended`, `calculated_max`. |
| 14 | `confidence_level` se calcula a partir de la cantidad y similitud de registros comparables y de si hay fórmula aprobada. |
| 12 (fórmulas) | `formulaGenerator` sólo consume `ExtractedWorkRecord` con `review_status: "approved"`. |
| 12 (calculadora) | Sólo `PricingFormula` con `review_status: "approved"` se usa en la calculadora final. |
