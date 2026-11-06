import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractFacts, normalizeFact } from '../services/factExtractor.js';

describe('factExtractor — datos que suelta la gente del clan', () => {
  test('detecta gustos', () => {
    assert.deepEqual(extractFacts('me gusta el pvp con los chavalos'), ['le gusta pvp con los chavalos']);
  });

  test('distingue gustos de disgustos', () => {
    const facts = extractFacts('no me gusta el free fire');
    assert.deepEqual(facts, ['no le gusta free fire']);
  });

  test('detecta edad', () => {
    assert.deepEqual(extractFacts('tengo 17 años ya ps'), ['tiene 17 años']);
  });

  test('detecta a qué juega', () => {
    assert.deepEqual(extractFacts('juego al blood strike todas las noches'), ['juega blood strike todas las noches']);
  });

  test('detecta de dónde es', () => {
    assert.deepEqual(extractFacts('soy de santa cruz'), ['es de santa cruz']);
  });

  test('detecta el nombre cuando lo dice explícitamente', () => {
    assert.deepEqual(extractFacts('me llamo paez y soy del clan'), ['se llama paez']);
  });

  test('no confunde "soy una chica" con un nombre', () => {
    const facts = extractFacts('soy una chica normal');
    assert.ok(!facts.some((f) => f.includes('una')));
  });

  test('ignora mensajes muy cortos o sin datos', () => {
    assert.deepEqual(extractFacts('ola'), []);
    assert.deepEqual(extractFacts('que haces'), []);
  });

  test('limita la cantidad de datos por mensaje', () => {
    const facts = extractFacts('me gusta el pvp, tengo 16 años, soy de la paz, juego al blood strike', 2);
    assert.equal(facts.length, 2);
  });

  test('normalizeFact elimina acentos, mayúsculas y signos', () => {
    assert.equal(normalizeFact('Le gusta el PVP!!'), 'le gusta el pvp');
    assert.equal(normalizeFact('se llama PÁEZ'), 'se llama paez');
  });
});
