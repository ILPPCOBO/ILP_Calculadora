/* Pantalla 7 — Calculadora.
   Campos: categoría, subcategoría, horas estimadas, perfil, tarifa/hora
   (placeholder "vacío = 250 EUR base"), complejidad, urgencia, tipo de fee,
   descuento %. POST /api/calculate. Muestra mín/recomendado/máx, fórmula
   usada, explicación, registros comparables, nivel de confianza, warnings.
   Marca CLARAMENTE cuando se usó la tarifa base (Reglas 2, 9, 10, 13, 14, 18). */

import {
  api, esc, dash, money, confidenceBadge, warningsBlock, errorState,
  toast, BASE_HOURLY_RATE,
} from '/app.js';

const FEE_TYPES = [['fixed', 'Precio fijo (cerrado)'], ['monthly', 'Iguala mensual'], ['hourly', 'Por horas'], ['blended', 'Mixto'], ['success_fee', 'Cuota de éxito']];
const COMPLEXITY = [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['unknown', 'Desconocida']];
const URGENCY = [['normal', 'Normal'], ['urgent', 'Urgente'], ['very_urgent', 'Muy urgente'], ['unknown', 'Desconocida']];

let categories = [];

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Calcula un honorario <strong>sugerido</strong> (no obligatorio, Regla 1). Elige el modelo: <strong>precio fijo</strong> o <strong>iguala mensual</strong> (lo habitual en España) o <strong>por horas</strong>. El sistema parte de tus <strong>acuerdos históricos aprobados</strong> del área; para "por horas" sin histórico usa la tarifa base de ${esc(BASE_HOURLY_RATE)} €/h (Regla 2).</p>
    </div>

    <div class="grid grid-2">
      <div class="card" style="align-self:start;">
        <h2 class="card-title">Parámetros del cálculo</h2>
        <div id="model-hint" class="alert alert-info" style="display:none;"></div>
        <div class="form-grid">
          <div class="field"><label>Categoría *</label><select id="c-cat"><option value="">Cargando…</option></select></div>
          <div class="field"><label>Subcategoría</label><select id="c-sub"><option value="">(ninguna)</option></select></div>
          <div class="field"><label>Modelo de honorario</label><select id="c-fee">${FEE_TYPES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
          <div class="field" id="hours-field"><label>Horas estimadas *</label><input type="number" step="0.5" min="0" id="c-hours" placeholder="p.ej. 10"></div>
          <div class="field" id="months-field" style="display:none;"><label>Meses (iguala)</label><input type="number" min="1" step="1" id="c-months" placeholder="1"><span class="hint">Duración de la iguala (mensualidades).</span></div>
          <div class="field" id="rate-field"><label>Tarifa / hora</label><input type="number" step="1" min="0" id="c-rate" placeholder="vacío = ${esc(BASE_HOURLY_RATE)} € base"><span class="hint">Sólo para honorario por horas. Vacío = tarifa base.</span></div>
          <div class="field"><label>Perfil profesional</label><input id="c-role" placeholder="p.ej. Socio / Asociado"></div>
          <div class="field"><label>Complejidad</label><select id="c-complexity">${COMPLEXITY.map(([v, l]) => `<option value="${v}" ${v === 'medium' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label>Urgencia</label><select id="c-urgency">${URGENCY.map(([v, l]) => `<option value="${v}" ${v === 'normal' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label>Descuento %</label><input type="number" step="1" min="0" max="100" id="c-discount" placeholder="0"></div>
          <div class="field"><label>Fórmula forzada (ID, opcional)</label><input id="c-formula" placeholder="(auto: busca la aprobada)"></div>
        </div>
        <div class="btn-row mt-8">
          <button class="btn btn-primary" id="btn-calc">Calcular honorario</button>
          <button class="btn btn-ghost" id="btn-reset">Limpiar</button>
        </div>
      </div>

      <div class="card" id="result-card">
        <h2 class="card-title">Resultado</h2>
        <div id="calc-result"><p class="muted">Introduce los parámetros y pulsa “Calcular honorario”.</p></div>
      </div>
    </div>
  `;

  const catSel = view.querySelector('#c-cat');
  const subSel = view.querySelector('#c-sub');

  try {
    categories = await api.listCategories();
    catSel.innerHTML = `<option value="">— Elige categoría —</option>` +
      categories.filter((c) => c.active !== false).map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  } catch (err) {
    catSel.innerHTML = `<option value="">(error al cargar)</option>`;
    toast(`No se pudieron cargar las categorías: ${err.message}`, 'error', 'Error');
  }

  const feeSel = view.querySelector('#c-fee');
  applyModelUI(view, feeSel.value);
  feeSel.addEventListener('change', () => applyModelUI(view, feeSel.value));

  catSel.addEventListener('change', async () => {
    const cat = categories.find((c) => c.name === catSel.value);
    subSel.innerHTML = `<option value="">(ninguna)</option>` +
      ((cat?.subcategories) || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    await suggestModel(view, catSel.value, null);
  });
  subSel.addEventListener('change', () => suggestModel(view, catSel.value, subSel.value || null));

  view.querySelector('#btn-reset').addEventListener('click', () => render(view));
  view.querySelector('#btn-calc').addEventListener('click', () => calculate(view));
}

/** Muestra/oculta horas, meses y tarifa según el modelo de honorario elegido. */
function applyModelUI(view, feeType) {
  const isMonthly = feeType === 'monthly';
  const isHourly = feeType === 'hourly' || feeType === 'blended';
  const set = (id, show) => { const el = view.querySelector(id); if (el) el.style.display = show ? '' : 'none'; };
  set('#hours-field', isHourly);
  set('#months-field', isMonthly);
  set('#rate-field', isHourly);
}

/** Consulta la referencia del área y preselecciona su modelo predominante + pista. */
async function suggestModel(view, category, subcategory) {
  const hint = view.querySelector('#model-hint');
  const feeSel = view.querySelector('#c-fee');
  if (!category) { if (hint) hint.style.display = 'none'; return; }
  try {
    const ref = await api.getReference(category, subcategory);
    if (ref && ref.predominant_fee_type) {
      feeSel.value = ref.predominant_fee_type;
      applyModelUI(view, feeSel.value);
      if (hint) { hint.style.display = ''; hint.innerHTML = `<span>❖</span><div>${esc(ref.note)}</div>`; }
    } else if (hint) {
      hint.style.display = '';
      hint.innerHTML = '<span>ℹ</span><div>Sin acuerdos aprobados en esta área todavía: aprueba registros para que sugiera precio fijo o iguala. Mientras, puedes calcular por horas.</div>';
    }
  } catch { if (hint) hint.style.display = 'none'; }
}

function valNum(el) { const v = el.value.trim(); return v === '' ? null : Number(v); }

async function calculate(view) {
  const cat = view.querySelector('#c-cat').value;
  if (!cat) { toast('Elige una categoría.', 'warn'); return; }

  const input = {
    service_category: cat,
    service_subcategory: view.querySelector('#c-sub').value || null,
    estimated_hours: valNum(view.querySelector('#c-hours')),
    estimated_months: valNum(view.querySelector('#c-months')),
    professional_role: view.querySelector('#c-role').value.trim() || null,
    hourly_rate: valNum(view.querySelector('#c-rate')),
    complexity_level: view.querySelector('#c-complexity').value,
    urgency_level: view.querySelector('#c-urgency').value,
    fee_type: view.querySelector('#c-fee').value,
    discount_percentage: valNum(view.querySelector('#c-discount')),
    selected_formula_id: view.querySelector('#c-formula').value.trim() || null,
    created_by: 'usuario_interno',
  };

  const btn = view.querySelector('#btn-calc'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Calculando…';
  const box = view.querySelector('#calc-result');
  box.innerHTML = `<div class="loading-state"><span class="spinner"></span><div>Calculando…</div></div>`;

  try {
    const res = await api.calculate(input);
    renderResult(box, res, input);
  } catch (err) {
    box.innerHTML = errorState(err);
    toast(err.message, 'error', 'Error');
  } finally { btn.textContent = t; btn.disabled = false; }
}

function renderResult(box, res, input) {
  // El backend puede devolver el CalcOutput directo o envuelto en { output }.
  const out = res.output || res;
  const bd = out.breakdown || {};
  // El aviso de "tarifa base" sólo aplica al modelo POR HORAS, no a precio fijo/iguala.
  const isHourlyResult = !(input.fee_type === 'fixed' || input.fee_type === 'monthly')
    && !/fijo|iguala/i.test(out.formula_used || '');
  const usedBase = isHourlyResult && (bd.used_base_rate === true ||
    (out.selected_formula_id == null && (input.hourly_rate == null || input.hourly_rate <= 0)));

  if (out.needs_input) {
    box.innerHTML = `<div class="alert alert-warn"><span>⚠</span><div>${esc(out.explanation || 'Faltan datos para calcular.')}</div></div>
      ${warningsBlock(out.warnings)}`;
    return;
  }

  const currency = out.currency || 'EUR';
  const comparables = out.comparable_records || out.comparable_record_ids || [];

  box.innerHTML = `
    <div class="alert alert-info"><span>ℹ</span><div>Honorario <strong>sugerido</strong>, no obligatorio (Regla 1).</div></div>

    ${usedBase ? `<div class="base-rate-flag mb-16">Se utilizó la TARIFA BASE de ${esc(BASE_HOURLY_RATE)} €/hora (no se introdujo tarifa personalizada).</div>` : ''}

    <div class="range-cards">
      <div class="range-card"><div class="rc-label">Mínimo</div><div class="rc-value">${money(out.calculated_min, currency)}</div></div>
      <div class="range-card rec"><div class="rc-label">Recomendado</div><div class="rc-value">${money(out.calculated_recommended, currency)}</div></div>
      <div class="range-card"><div class="rc-label">Máximo</div><div class="rc-value">${money(out.calculated_max, currency)}</div></div>
    </div>

    <dl class="kv mb-16">
      <dt>Confianza</dt><dd>${confidenceBadge(out.confidence_level)}</dd>
      <dt>Fórmula usada</dt><dd>${dash(out.formula_used)} ${out.selected_formula_id ? `<span class="small mono">[${esc(out.selected_formula_id)}]</span>` : '<span class="pill pill-gold">Tarifa base</span>'}</dd>
      <dt>Tarifa efectiva</dt><dd>${bd.effective_hourly_rate != null ? money(bd.effective_hourly_rate, currency) + '/hora' : '<span class="muted">—</span>'}</dd>
    </dl>

    ${warningsBlock(out.warnings)}

    <h3>Explicación (Reglas 9, 10, 18)</h3>
    <p class="small">${esc(out.explanation || '—')}</p>

    ${renderBreakdown(bd, currency)}

    ${renderReference(out.reference, currency)}

    <h3 class="mt-16">Registros comparables que lo respaldan (Regla 10)</h3>
    ${comparables.length
      ? `<p class="small muted">${comparables.length} registro(s) aprobado(s):</p><div class="tag-list">${comparables.map((id) => `<span class="pill pill-muted mono">${esc(id)}</span>`).join('')}</div>`
      : `<p class="small muted">Sin registros históricos comparables. ${out.confidence_level === 'low' ? 'Información insuficiente (Regla 11).' : ''}</p>`}

    <div class="btn-row mt-16">
      <button class="btn" id="btn-breakdown">Generar desglose de actuaciones previstas</button>
      <button class="btn btn-primary" id="btn-proposal">Generar propuesta de honorarios</button>
    </div>
  `;

  const bd = box.querySelector('#btn-breakdown');
  if (bd) bd.addEventListener('click', () => generateBreakdownFromCalc(bd, out, input));
  const bp = box.querySelector('#btn-proposal');
  if (bp) bp.addEventListener('click', () => generateProposalFromCalc(bp, out, input));
}

/** Crea una propuesta de honorarios a partir de este cálculo manual y abre la pantalla. */
async function generateProposalFromCalc(btn, out, input) {
  if (out.needs_input) { toast('Completa el cálculo antes de generar la propuesta.', 'warn'); return; }
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const rate = (out.breakdown && out.breakdown.effective_hourly_rate) || input.hourly_rate || BASE_HOURLY_RATE;
    const prop = await api.createProposal({
      kind: 'simple',
      case_or_calculation_id: out.calculation_id || null,
      service_category: out.service_category || input.service_category,
      service_subcategory: out.service_subcategory || input.service_subcategory || null,
      description: null,
      tasks: [],
      currency: out.currency || 'EUR',
      rate_used: rate,
      hours_recommended: input.estimated_hours ?? null,
      fee_min: out.calculated_min ?? null,
      fee_recommended: out.calculated_recommended ?? null,
      fee_max: out.calculated_max ?? null,
      confidence_level: out.confidence_level || 'low',
      created_by: 'usuario_interno',
    });
    toast('Propuesta generada.', 'ok');
    location.hash = `#/proposals?id=${encodeURIComponent(prop.id)}`;
  } catch (err) {
    toast(err.message, 'error', 'Error');
    btn.textContent = t; btn.disabled = false;
  }
}

/** Crea un desglose de actuaciones asociado a este cálculo manual y abre la pantalla. */
async function generateBreakdownFromCalc(btn, out, input) {
  if (out.needs_input) { toast('Completa el cálculo antes de generar el desglose.', 'warn'); return; }
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const rate = (out.breakdown && out.breakdown.effective_hourly_rate) || input.hourly_rate || BASE_HOURLY_RATE;
    const brk = await api.createBreakdown({
      source_type: 'manual_calculation',
      case_or_calculation_id: out.calculation_id || null,
      service_category: out.service_category || input.service_category,
      service_subcategory: out.service_subcategory || input.service_subcategory || null,
      description: null,
      tasks: [],
      estimated_total_hours: input.estimated_hours ?? null,
      estimated_total_fee: out.calculated_recommended ?? null,
      currency: out.currency || 'EUR',
      rate_used: rate,
      complexity_level: input.complexity_level,
      urgency_level: input.urgency_level,
      created_by: 'usuario_interno',
    });
    toast('Desglose generado.', 'ok');
    location.hash = `#/planned-actions?id=${encodeURIComponent(brk.id)}`;
  } catch (err) {
    toast(err.message, 'error', 'Error');
    btn.textContent = t; btn.disabled = false;
  }
}

/** Tarjeta de REFERENCIA histórica de precios del área (acuerdos aprobados). */
export function renderReference(ref, currency) {
  if (!ref) return '';
  if (!ref.sample_size || ref.sample_size === 0) {
    return `<h3 class="mt-16">Referencia histórica del área (acuerdos antiguos)</h3>
      <div class="alert alert-warn"><span>⚠</span><div>${esc(ref.note || 'Información insuficiente para una referencia histórica.')}</div></div>`;
  }
  const cur = ref.currency || currency;
  const hourly = ref.hourly_rate_median != null
    ? `<dt>Tarifa/hora típica</dt><dd>${money(ref.hourly_rate_median, cur)}/hora <span class="small muted">(mediana de ${ref.hourly_sample_size})</span></dd>`
    : '';
  const dist = ref.fee_type_distribution && Object.keys(ref.fee_type_distribution).length
    ? `<dt>Tipos de fee</dt><dd>${Object.entries(ref.fee_type_distribution).map(([k, n]) => `<span class="pill pill-muted">${esc(k)}: ${n}</span>`).join(' ')}</dd>`
    : '';
  const dates = (ref.date_from || ref.date_to)
    ? `<dt>Periodo</dt><dd class="small">${dash(ref.date_from)} → ${dash(ref.date_to)}</dd>`
    : '';
  return `
    <h3 class="mt-16">Referencia histórica del área (acuerdos antiguos aprobados)</h3>
    <div class="alert alert-info"><span>❖</span><div>${esc(ref.note)} ${confidenceBadge(ref.confidence_level)}</div></div>
    <div class="range-cards">
      <div class="range-card"><div class="rc-label">P25 histórico</div><div class="rc-value">${money(ref.fee_p25, cur)}</div></div>
      <div class="range-card rec"><div class="rc-label">Mediana histórica</div><div class="rc-value">${money(ref.fee_median, cur)}</div></div>
      <div class="range-card"><div class="rc-label">P75 histórico</div><div class="rc-value">${money(ref.fee_p75, cur)}</div></div>
    </div>
    <dl class="kv mt-8">
      <dt>Acuerdos con importe</dt><dd>${esc(ref.sample_size)} de ${esc(ref.records_considered)} aprobados</dd>
      <dt>Rango (mín / media / máx)</dt><dd>${money(ref.fee_min, cur)} · ${money(ref.fee_average, cur)} · ${money(ref.fee_max, cur)}</dd>
      ${hourly}
      ${dist}
      ${dates}
    </dl>`;
}

function renderBreakdown(bd, currency) {
  if (!bd || Object.keys(bd).length === 0) return '';
  const hist = (bd.historical_median != null)
    ? `<dt>Histórico (p25 / mediana / p75)</dt><dd>${money(bd.historical_p25, currency)} · ${money(bd.historical_median, currency)} · ${money(bd.historical_p75, currency)}</dd>`
    : '';
  return `<h3 class="mt-16">Factores aplicados</h3>
    <dl class="kv">
      <dt>Tarifa/hora efectiva</dt><dd>${bd.effective_hourly_rate != null ? money(bd.effective_hourly_rate, currency) : '—'}</dd>
      <dt>Factor complejidad</dt><dd>${dash(bd.complexity_factor)}</dd>
      <dt>Factor urgencia</dt><dd>${dash(bd.urgency_factor)}</dd>
      <dt>Factor descuento</dt><dd>${dash(bd.discount_factor)}</dd>
      ${hist}
    </dl>`;
}
