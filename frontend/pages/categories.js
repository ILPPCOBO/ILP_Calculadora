/* Pantalla 4 — Categorías.
   GET/POST/PUT /api/categories. Ver/crear/editar subcategorías,
   default_hourly_rate (inicial 250), activar/desactivar. Regla 2. */

import {
  api, esc, errorState, emptyState, loadingState, toast, BASE_HOURLY_RATE,
} from '/app.js';

const PRICING_METHODS = [['hourly', 'Por horas'], ['fixed', 'Precio fijo'], ['blended', 'Mixta'], ['monthly', 'Mensual'], ['custom', 'Personalizada']];

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Define las categorías de servicio y sus subcategorías. La tarifa por hora por defecto parte de la tarifa base de <strong>${esc(BASE_HOURLY_RATE)} €/hora</strong> (Regla 2).</p>
    </div>
    <div class="grid grid-2">
      <div class="card" style="align-self:start;">
        <h2 class="card-title">Nueva categoría</h2>
        <div id="new-cat-form"></div>
      </div>
      <div class="card">
        <div class="flex between center mb-8">
          <h2 class="card-title mb-0">Categorías existentes</h2>
          <button class="btn btn-sm" id="btn-refresh">Actualizar</button>
        </div>
        <div id="cat-list">${loadingState()}</div>
      </div>
    </div>
  `;

  renderNewForm(view);
  view.querySelector('#btn-refresh').addEventListener('click', () => loadCategories(view));
  await loadCategories(view);
}

function renderNewForm(view) {
  const box = view.querySelector('#new-cat-form');
  box.innerHTML = `
    <div class="field"><label>Nombre</label><input id="nc-name" placeholder="p.ej. Propiedad Intelectual"></div>
    <div class="field"><label>Descripción</label><textarea id="nc-desc" placeholder="Breve descripción de la categoría"></textarea></div>
    <div class="field"><label>Subcategorías (una por línea)</label><textarea id="nc-subs" placeholder="Registro de marca&#10;Oposición&#10;Renovación"></textarea></div>
    <div class="form-grid">
      <div class="field"><label>Método por defecto</label><select id="nc-method">${PRICING_METHODS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Tarifa/hora por defecto</label><input type="number" step="1" id="nc-rate" value="${esc(BASE_HOURLY_RATE)}"><span class="hint">Inicial: ${esc(BASE_HOURLY_RATE)} € (tarifa base)</span></div>
      <div class="field"><label>Factor de complejidad</label><input type="number" step="0.01" id="nc-cf" value="1.0"></div>
      <div class="field"><label>Activa</label><select id="nc-active"><option value="true">Sí</option><option value="false">No</option></select></div>
    </div>
    <div class="btn-row mt-8"><button class="btn btn-primary" id="nc-save">Crear categoría</button></div>
  `;

  box.querySelector('#nc-save').addEventListener('click', async (e) => {
    const name = box.querySelector('#nc-name').value.trim();
    if (!name) { toast('El nombre es obligatorio.', 'warn'); return; }
    const btn = e.currentTarget; btn.disabled = true;
    const payload = {
      name,
      description: box.querySelector('#nc-desc').value.trim(),
      subcategories: box.querySelector('#nc-subs').value.split('\n').map((s) => s.trim()).filter(Boolean),
      default_pricing_method: box.querySelector('#nc-method').value,
      default_hourly_rate: Number(box.querySelector('#nc-rate').value) || BASE_HOURLY_RATE,
      default_complexity_factor: Number(box.querySelector('#nc-cf').value) || 1.0,
      active: box.querySelector('#nc-active').value === 'true',
    };
    try {
      await api.createCategory(payload);
      toast('Categoría creada.', 'ok', 'Creada');
      renderNewForm(view);
      loadCategories(view);
    } catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });
}

async function loadCategories(view) {
  const box = view.querySelector('#cat-list');
  let cats;
  try { cats = await api.listCategories(); }
  catch (err) { box.innerHTML = errorState(err); return; }
  if (!cats || cats.length === 0) { box.innerHTML = emptyState('No hay categorías. Crea la primera.', '❏'); return; }
  box.innerHTML = cats.map(catItem).join('');
  cats.forEach((c) => wireCat(view, c));
}

function catItem(c) {
  const subs = (c.subcategories || []).map((s) => `<span class="pill pill-muted">${esc(s)}</span>`).join(' ');
  return `<div class="review-item" data-cat="${esc(c.id)}">
    <div class="review-item-head">
      <h3>${esc(c.name)}</h3>
      <span class="pill ${c.active ? 'pill-approved' : 'pill-muted'}">${c.active ? 'Activa' : 'Inactiva'}</span>
    </div>
    <div class="review-item-body">
      <div class="field"><label>Nombre</label><input data-f="name" value="${esc(c.name)}"></div>
      <div class="field"><label>Descripción</label><textarea data-f="description">${esc(c.description || '')}</textarea></div>
      <div class="field"><label>Subcategorías (una por línea)</label><textarea data-f="subcategories">${esc((c.subcategories || []).join('\n'))}</textarea>
        <div class="tag-list mt-8">${subs || '<span class="muted small">Sin subcategorías</span>'}</div></div>
      <div class="form-grid">
        <div class="field"><label>Método por defecto</label><select data-f="default_pricing_method">${PRICING_METHODS.map(([v, l]) => `<option value="${v}" ${v === c.default_pricing_method ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>Tarifa/hora por defecto</label><input type="number" step="1" data-f="default_hourly_rate" value="${esc(c.default_hourly_rate ?? BASE_HOURLY_RATE)}"></div>
        <div class="field"><label>Factor de complejidad</label><input type="number" step="0.01" data-f="default_complexity_factor" value="${esc(c.default_complexity_factor ?? 1.0)}"></div>
      </div>
    </div>
    <div class="review-actions">
      <button class="btn btn-primary" data-act="save">Guardar cambios</button>
      <button class="btn ${c.active ? 'btn-danger' : 'btn-ok'}" data-act="toggle">${c.active ? 'Desactivar' : 'Activar'}</button>
    </div>
  </div>`;
}

function wireCat(view, c) {
  const el = view.querySelector(`.review-item[data-cat="${cssEsc(c.id)}"]`);
  if (!el) return;

  function collect() {
    const patch = {};
    el.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      if (f === 'subcategories') patch[f] = inp.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else if (inp.type === 'number') patch[f] = Number(inp.value);
      else patch[f] = inp.value;
    });
    return patch;
  }

  el.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await api.updateCategory(c.id, collect()); toast('Categoría actualizada.', 'ok'); loadCategories(view); }
    catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });
  el.querySelector('[data-act="toggle"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await api.updateCategory(c.id, { active: !c.active }); toast(c.active ? 'Categoría desactivada.' : 'Categoría activada.', 'ok'); loadCategories(view); }
    catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });
}

function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
