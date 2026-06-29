/* Tests de navegación — verifican que "Describir caso" es la primera sección y
   que "Panel"/dashboard ya no aparece. Lee los archivos del frontend (sin servidor). */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(ROOT, 'frontend', 'index.html'), 'utf8');
const appJs = readFileSync(join(ROOT, 'frontend', 'app.js'), 'utf8');

test('el menú lateral incluye "Describir caso" con su ruta', () => {
  assert.match(indexHtml, /Describir caso/);
  assert.match(indexHtml, /data-route="describe-case"/);
});

test('"Panel" / dashboard ya NO aparece en el menú', () => {
  assert.ok(!/data-route="dashboard"/.test(indexHtml), 'no debe quedar la ruta dashboard en el menú');
  assert.ok(!/>\s*Panel\s*</.test(indexHtml), 'no debe quedar el enlace "Panel"');
});

test('el menú tiene exactamente las 7 secciones esperadas en orden', () => {
  const routes = [...indexHtml.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(routes, ['describe-case', 'upload', 'records', 'areas', 'calculator', 'planned-actions', 'history']);
});

test('app.js: la ruta inicial por defecto es describe-case y ya no usa dashboard.js', () => {
  assert.match(appJs, /DEFAULT_ROUTE\s*=\s*'describe-case'/);
  assert.ok(!appJs.includes('/pages/dashboard.js'), 'no debe cargar pages/dashboard.js');
});

test('el componente pages/dashboard.js ha sido eliminado', () => {
  assert.ok(!existsSync(join(ROOT, 'frontend', 'pages', 'dashboard.js')), 'dashboard.js no debe existir');
});

test('existe la pantalla pages/describeCase.js', () => {
  assert.ok(existsSync(join(ROOT, 'frontend', 'pages', 'describeCase.js')));
});
