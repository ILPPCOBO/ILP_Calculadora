/* Pantalla 6 — Revisar fórmulas.
   GET /api/formulas?status=pending_review. Editar expresión/variables/
   factores/assumptions. Aprobar/Rechazar. Si la API responde "missing" al
   aprobar (faltan campos para aprobar, Regla 13), se muestra claramente. */

import {
  api, esc, dash, money, statusPill, confidenceBadge, errorState,
  emptyState, loadingState, toast,
} from '/app.js';

const FORMULA_TYPES = [['hourly', 'Por horas'], ['fixed_range', 'Rango fijo'], ['blended', 'Mixta'], ['monthly', 'Mensual'], ['custom', 'Personalizada']];
const STATUS_FILTERS = [['pending_review', 'Pendientes'], ['approved', 'Aprobadas'], ['rejected', 'Rechazadas'], ['', 'Todas']];

const MISSING_LABELS = {
  service_category: 'Categoría de servicio',
  formula_expression: 'Expresión de la fórmula',
  variables: 'Variables',
  assumptions: 'Supuestos (assumptions)',
  based_on_record_ids: 'Registros base o supuesto que justifique la tarifa base',
};

let currentStatus = 'pending_review';

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Revisa, ajusta y aprueba las fórmulas. Solo las fórmulas <strong>aprobadas</strong> se usan en la calculadora (Regla 12). Para aprobar, la fórmula necesita categoría, expresión, variables, supuestos y o bien registros base o un supuesto que justifique el uso de la tarifa base (Regla 13).</p>
    </div>
    <div class="btn-row mb-16" id="status-filters">
      ${STATUS_FILTERS.map(([v, l]) => `<button class="btn btn-sm ${v === currentStatus ? 'btn-navy' : ''}" data-status="${v}">${esc(l)}</button>`).join('')}
    </div>
    <div id="formulas-box">${loadingState()}</div>
  `;

  view.querySelectorAll('#status-filters [data-status]').forEach((b) =>
    b.addEventListener('click', () => { currentStatus = b.dataset.status; render(view); }));

  await loadFormulas(view);
}

async function loadFormulas(view) {
  const box = view.querySelector('#formulas-box');
  let formulas;
  try { formulas = await api.listFormulas(currentStatus || undefined); }
  catch (err) { box.innerHTML = errorState(err); return; }
  if (!formulas || formulas.length === 0) { box.innerHTML = emptyState('No hay fórmulas en este estado.', '✓'); return; }
  box.innerHTML = formulas.map(formulaItem).join('');
  formulas.forEach((f) => wireFormula(view, f));
}

function formulaItem(f) {
  const editable = f.review_status === 'pending_review';
  const dis = editable ? '' : 'disabled';
  const basedOn = (f.based_on_record_ids || []).join('\n');
  return `<div class="review-item" data-formula="${esc(f.id)}">
    <div class="review-item-head">
      <h3>${esc(f.formula_name || 'Fórmula sin nombre')}</h3>
      <div class="flex gap-12 center">${confidenceBadge(f.confidence_level)} ${statusPill(f.review_status)}</div>
    </div>
    <div class="review-item-body">
      <div class="small muted mb-16">ID ${esc(f.id)} · ${esc(f.service_category)}${f.service_subcategory ? ' / ' + esc(f.service_subcategory) : ''}</div>
      ${f.rejected_reason ? `<div class="alert alert-danger"><span>✕</span><div>Motivo de rechazo: ${esc(f.rejected_reason)}</div></div>` : ''}
      ${f.review_status === 'approved' ? `<div class="alert alert-ok"><span>✓</span><div>Aprobada por ${dash(f.approved_by)}</div></div>` : ''}
      <div class="missing-box"></div>

      <div class="form-grid">
        <div class="field"><label>Nombre</label><input data-f="formula_name" value="${esc(f.formula_name ?? '')}" ${dis}></div>
        <div class="field"><label>Tipo</label><select data-f="formula_type" ${dis}>${FORMULA_TYPES.map(([v, l]) => `<option value="${v}" ${v === f.formula_type ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Expresión</label><textarea data-f="formula_expression" ${dis} class="mono">${esc(f.formula_expression ?? '')}</textarea></div>

      <div class="form-grid">
        <div class="field"><label>Recomendado mín.</label><input type="number" step="0.01" data-f="recommended_min" value="${numVal(f.recommended_min)}" ${dis}></div>
        <div class="field"><label>Recomendado base</label><input type="number" step="0.01" data-f="recommended_base" value="${numVal(f.recommended_base)}" ${dis}></div>
        <div class="field"><label>Recomendado máx.</label><input type="number" step="0.01" data-f="recommended_max" value="${numVal(f.recommended_max)}" ${dis}></div>
        <div class="field"><label>Moneda</label><input data-f="currency" value="${esc(f.currency ?? 'EUR')}" ${dis}></div>
      </div>

      <div class="field"><label>Variables (JSON: name, description, default)</label><textarea data-f="variables" ${dis} class="mono">${esc(JSON.stringify(f.variables || [], null, 2))}</textarea>
        <span class="hint">Formato: lista de objetos {"name","description","default"}.</span></div>
      <div class="field"><label>Supuestos / assumptions (uno por línea)</label><textarea data-f="assumptions" ${dis}>${esc((f.assumptions || []).join('\n'))}</textarea></div>
      <div class="field"><label>Registros base (un ID por línea)</label><textarea data-f="based_on_record_ids" ${dis}>${esc(basedOn)}</textarea></div>
    </div>
    ${editable ? `<div class="review-actions">
      <button class="btn btn-primary" data-act="save">Guardar cambios</button>
      <button class="btn btn-ok" data-act="approve">Aprobar</button>
      <button class="btn btn-danger" data-act="reject">Rechazar</button>
    </div>` : ''}
  </div>`;
}

function wireFormula(view, f) {
  const el = view.querySelector(`.review-item[data-formula="${cssEsc(f.id)}"]`);
  if (!el) return;
  const missingBox = el.querySelector('.missing-box');

  function collect() {
    const patch = {};
    let parseError = null;
    el.querySelectorAll('[data-f]').forEach((inp) => {
      const f2 = inp.dataset.f;
      if (f2 === 'variables') {
        try { patch[f2] = JSON.parse(inp.value || '[]'); }
        catch { parseError = 'El campo Variables no es JSON válido.'; }
      } else if (f2 === 'assumptions' || f2 === 'based_on_record_ids') {
        patch[f2] = inp.value.split('\n').map((s) => s.trim()).filter(Boolean);
      } else if (inp.type === 'number') {
        patch[f2] = inp.value.trim() === '' ? null : Number(inp.value);
      } else {
        patch[f2] = inp.value.trim() === '' ? null : inp.value;
      }
    });
    if (parseError) { toast(parseError, 'warn'); return null; }
    return patch;
  }

  el.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
    const patch = collect(); if (!patch) return;
    const btn = e.currentTarget; btn.disabled = true;
    try { await api.updateFormula(f.id, patch); toast('Fórmula actualizada.', 'ok'); }
    catch (err) { toast(err.message, 'error', 'Error'); }
    finally { btn.disabled = false; }
  });

  el.querySelector('[data-act="approve"]')?.addEventListener('click', async (e) => {
    const patch = collect(); if (!patch) return;
    const btn = e.currentTarget; btn.disabled = true;
    missingBox.innerHTML = '';
    try {
      await api.updateFormula(f.id, patch);
      const res = await api.approveFormula(f.id, 'usuario_interno');
      // El contrato puede devolver { ok, missing } o lanzar 4xx con body.missing.
      if (res && res.ok === false) {
        showMissing(missingBox, res.missing);
        toast('No se puede aprobar: faltan campos.', 'warn', 'Faltan datos');
        btn.disabled = false;
        return;
      }
      toast('Fórmula aprobada y disponible para la calculadora.', 'ok', 'Aprobada');
      loadFormulas(view);
    } catch (err) {
      const missing = err.body && err.body.missing;
      if (missing && missing.length) {
        showMissing(missingBox, missing);
        toast('No se puede aprobar: faltan campos.', 'warn', 'Faltan datos');
      } else {
        toast(err.message, 'error', 'Error');
      }
      btn.disabled = false;
    }
  });

  el.querySelector('[data-act="reject"]')?.addEventListener('click', async (e) => {
    const reason = window.prompt('Motivo del rechazo de la fórmula:', '');
    if (reason === null) return;
    if (!reason.trim()) { toast('El motivo es obligatorio.', 'warn'); return; }
    const btn = e.currentTarget; btn.disabled = true;
    try { await api.rejectFormula(f.id, reason.trim(), 'usuario_interno'); toast('Fórmula rechazada.', 'ok', 'Rechazada'); loadFormulas(view); }
    catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });
}

function showMissing(box, missing) {
  const items = (missing || []).map((m) => `<li>${esc(MISSING_LABELS[m] || m)}</li>`).join('');
  box.innerHTML = `<div class="alert alert-danger"><span>✕</span><div>
    <strong>No se puede aprobar todavía. Faltan (Regla 13):</strong><ul>${items}</ul></div></div>`;
}

function numVal(v) { return v === null || v === undefined ? '' : esc(v); }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
