/* Tests de serviceClassifier — coincidencia por LÍMITE DE PALABRA.
   Regresión del bug de subcadena (la clave corta "ere" saltaba dentro de
   "derecho", "mica" dentro de "quimica", "spa" dentro de "espacio"). */

import { test } from 'node:test';
import assert from 'node:assert';
import { classify } from '../services/serviceClassifier.ts';

test('subcadena "ere" en "derecho(s)" NO clasifica como Laboral (bug de subcadena)', () => {
  const r = classify({
    service_description:
      'Defensa de los derechos de un socio minoritario: revisar la documentación '
      + 'societaria, emitir un dictamen sobre el derecho de información y preparar '
      + 'la impugnación de los acuerdos sociales frente a la mayoría.',
  });
  assert.notStrictEqual(
    r.service_category, 'Laboral',
    `no debe clasificarse Laboral por "ere" dentro de "derecho" (fue "${r.service_category}")`,
  );
});

test('"ERE" como palabra real SÍ clasifica como Laboral', () => {
  const r = classify({
    service_description:
      'Tramitación de un expediente de regulación de empleo (ERE) y despido '
      + 'colectivo, con negociación del periodo de consultas.',
  });
  assert.strictEqual(
    r.service_category, 'Laboral',
    `debe clasificarse Laboral con "ERE"/"despido" como palabras reales (fue "${r.service_category}")`,
  );
});

test('subcadena "mica" en "quimica" NO clasifica como Regulatorio financiero', () => {
  const r = classify({
    service_description:
      'Asesoramiento contractual a una empresa de la industria quimica sobre el '
      + 'suministro de productos a un cliente.',
  });
  assert.notStrictEqual(
    r.service_category, 'Regulatorio financiero',
    `no debe clasificarse Regulatorio financiero por "mica" en "quimica" (fue "${r.service_category}")`,
  );
});

test('coincidencia por palabra completa sigue detectando la categoría correcta', () => {
  const r = classify({
    service_description:
      'Plan de reestructuracion de deuda financiera con homologacion judicial y '
      + 'negociación con los acreedores.',
  });
  assert.strictEqual(
    r.service_category, 'Reestructuraciones',
    `debe clasificarse Reestructuraciones por coincidencia de palabra completa (fue "${r.service_category}")`,
  );
});
