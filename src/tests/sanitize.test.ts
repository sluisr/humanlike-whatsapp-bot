import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  pickFallbackText,
  resolveReplyText,
  sanitizePersonaReply,
  stripRolePrefixes,
} from '../persona/sanitize.js';

describe('sanitize — limpieza y garantía de respuesta', () => {
  test('el texto vacío cae al fallback: el bot nunca queda mudo', () => {
    assert.equal(resolveReplyText('', 'toma'), 'toma');
    assert.equal(resolveReplyText('   ', 'toma'), 'toma');
    assert.equal(resolveReplyText('\n\n', 'toma'), 'toma');
  });

  test('el texto con contenido se respeta y se recorta', () => {
    assert.equal(resolveReplyText('  que haces  ', 'toma'), 'que haces');
    assert.equal(resolveReplyText('uyy y ese amor de donde salio', 'toma'), 'uyy y ese amor de donde salio');
  });

  test('si el fallback también viene vacío, sale una respuesta mínima', () => {
    assert.equal(resolveReplyText('', ''), 'que');
    assert.equal(resolveReplyText('', '   '), 'que');
  });

  test('quita prefijos tipo guion de teatro', () => {
    assert.equal(stripRolePrefixes('[Carlos]: hola nicol'), 'hola nicol');
    assert.equal(stripRolePrefixes('(Sofia): que haces'), 'que haces');
  });

  test('extrae el sticker inline y limpia el texto', () => {
    const result = sanitizePersonaReply('toma [sticker: feliz_sonrisa]', {
      isGroup: false,
      isCreatorSpeaking: true,
      userText: 'hola',
    });

    assert.equal(result.text, 'toma');
    assert.equal(result.stickerTag, 'feliz_sonrisa');
  });

  test('en grupo no le dice "luis" a quien no lo es', () => {
    const result = sanitizePersonaReply('uy luis que haces', {
      isGroup: true,
      isCreatorSpeaking: false,
      userText: 'jugamos?',
    });

    assert.doesNotMatch(result.text, /\bluis\b/i);
  });

  test('una respuesta del modelo vacía queda vacía: la rescata el fallback', () => {
    const result = sanitizePersonaReply('', {
      isGroup: false,
      isCreatorSpeaking: true,
      userText: 'sip soy yo amor',
    });

    assert.equal(result.text, '');
    assert.equal(resolveReplyText(result.text, 'toma'), 'toma');
  });
});

describe('pickFallbackText — la frase del sticker no se repite', () => {
  const pool = ['toma', 'che', 'mira', 'ahi va', 'tenes'];

  test('devuelve siempre una frase del repertorio, nunca vacío', () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(pool.includes(pickFallbackText(pool)));
    }
  });

  test('evita las frases recién usadas', () => {
    assert.equal(pickFallbackText(pool, ['toma', 'che', 'mira', 'ahi va'], () => 0), 'tenes');
  });

  test('si ya usó todas, igual responde algo del repertorio', () => {
    assert.ok(pool.includes(pickFallbackText(pool, pool, () => 0)));
  });

  test('con repertorio vacío cae a una respuesta mínima', () => {
    assert.equal(pickFallbackText([]), 'que');
    assert.equal(pickFallbackText(['  ', '']), 'que');
  });

  test('es determinista con un rng inyectado', () => {
    assert.equal(pickFallbackText(pool, [], () => 0), 'toma');
    assert.equal(pickFallbackText(pool, [], () => 0.999), 'tenes');
  });

  test('no distingue mayúsculas ni espacios al recordar las usadas', () => {
    assert.equal(pickFallbackText(pool, [' TOMA '], () => 0.2), 'che');
  });
});
