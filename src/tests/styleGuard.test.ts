import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  aggressionRate,
  applyStyleGuard,
  buildRephraseInstruction,
  countLaughs,
  findRepetition,
  hasAggression,
  hasLaugh,
  isEcho,
  laughRate,
  normalizeEchoText,
  resolveStylePolicy,
  similarity,
  stripLaughs,
  tokenize,
} from '../services/styleGuard.js';

describe('styleGuard — risas medidas y anti-repetición', () => {
  test('detecta y cuenta risas de todo tipo', () => {
    assert.equal(hasLaugh('jajaja que haces'), true);
    assert.equal(hasLaugh('jsjsjs'), true);
    assert.equal(hasLaugh('kajsjsjs'), true);
    assert.equal(hasLaugh('que haces'), false);
    assert.equal(countLaughs('jajaja y despues jsjs'), 2);
  });

  test('recorta las risas sin romper la frase', () => {
    assert.equal(stripLaughs('jajaja que haces?').text, 'que haces?');
    assert.equal(stripLaughs('que haces kajsjsjs').text, 'que haces');
    assert.equal(stripLaughs('jajaja').text, 'je');
    assert.equal(stripLaughs('de una').removed, 0);
  });

  test('mide la tasa de risas en una ventana de mensajes', () => {
    assert.equal(laughRate([]), 0);
    assert.equal(laughRate(['jajaja', 'que haces', 'jsjs']), 2 / 3);
  });

  test('detecta frases repetidas por similitud', () => {
    const previos = ['que haces ps', 'no se que querias'];
    const repetido = findRepetition('que haces ps', previos);

    assert.ok(repetido);
    assert.equal(repetido?.score, 1);
    assert.equal(findRepetition('hola que tal, todo bien?', previos), undefined);
    assert.ok(similarity('jugamos blood hoy?', 'jugamos blood hoy') > 0.7);
    assert.equal(tokenize('de la que no sirve').includes('de'), false);
  });

  test('recorta risas cuando ya venía abusando y el usuario no se rió', () => {
    const botHistory = ['jajaja que haces', 'jsjsjs dale', 'jajaja nada'];
    const reporte = applyStyleGuard({
      text: 'hola nicol jajaja',
      botHistory,
      userText: 'hola nicol',
    });

    assert.equal(reporte.text, 'hola nicol');
    assert.equal(reporte.laughsRemoved, 1);
    assert.ok(reporte.laughRate >= 1);
  });

  test('si el usuario se rió, responderse riendo es natural y no se recorta', () => {
    const botHistory = ['jajaja que haces', 'jsjsjs dale', 'jajaja nada'];
    const reporte = applyStyleGuard({
      text: 'jajaja que haces',
      botHistory,
      userText: 'jajajaja nicol',
    });

    assert.equal(reporte.laughsRemoved, 0);
    assert.equal(hasLaugh(reporte.text), true);
  });

  test('marca repetición cuando repite una frase propia', () => {
    const reporte = applyStyleGuard({
      text: 'no se, vos que querias',
      botHistory: ['no se, vos que querias'],
      userText: 'y que mas',
    });

    assert.equal(reporte.needsRephrase, true);
    assert.equal(reporte.repetition?.score, 1);
  });

  test('la instrucción de reformulación nombra la frase repetida', () => {
    const reporte = applyStyleGuard({
      text: 'no se, vos que querias',
      botHistory: ['no se, vos que querias'],
      userText: 'y que mas',
    });

    const instruccion = buildRephraseInstruction(reporte);
    assert.match(instruccion, /no se, vos que querias/);
    assert.match(instruccion, /Reformulalo/);
  });

  test('la política sale de la config y se puede sobreescribir', () => {
    const policy = resolveStylePolicy({ maxLaughRate: 0.5, window: 3 });
    assert.equal(policy.maxLaughRate, 0.5);
    assert.equal(policy.window, 3);
    assert.equal(typeof policy.repetitionThreshold, 'number');
    assert.equal(typeof policy.maxAggressionRate, 'number');
  });
});

describe('styleGuard — monotonía de tono (no repetir el mismo filo)', () => {
  test('detecta el filo verbal en insultos y desafíos', () => {
    assert.equal(hasAggression('sos un manco'), true);
    assert.equal(hasAggression('te gano cuando quieras'), true);
    assert.equal(hasAggression('callate vos'), true);
    assert.equal(hasAggression('ya fue, jugamos blood?'), false);
    assert.equal(hasAggression('que haces'), false);
  });

  test('mide la tasa de mensajes con filo', () => {
    assert.equal(aggressionRate([]), 0);
    assert.equal(aggressionRate(['sos un manco', 'que haces', 'te gano']), 2 / 3);
    assert.equal(aggressionRate(['nada ps', 'de una']), 0);
  });

  test('pide variar el recurso cuando viene repitiendo el mismo filo', () => {
    const botHistory = ['sos un manco', 'te gano siempre', 'callate vos', 'sos malo ps'];
    const reporte = applyStyleGuard({
      text: 'sos un manco igual',
      botHistory,
      userText: 'por que tan agresiva',
      policy: { maxAggressionRate: 0.6 },
    });

    assert.equal(reporte.toneBroke, true);
    assert.equal(reporte.needsRephrase, true);
    assert.ok(reporte.aggressionRate >= 0.6);
    assert.match(buildRephraseInstruction(reporte), /recurso/);
  });

  test('con el umbral por defecto, insultar seguido NO le pide bajar el filo', () => {
    const reporte = applyStyleGuard({
      text: 'callate la verga',
      botHistory: ['sos un manco', 'te gano siempre', 'callate vos', 'sos malo ps'],
      userText: 'por que tan agresiva',
    });

    assert.equal(reporte.aggressionRate, 0.75);
    assert.equal(reporte.toneBroke, false, 'el pedido es que no se limite al insultar');
  });

  test('si clava el mismo filo en TODOS los mensajes, le pide variar el recurso y no bajar el filo', () => {
    const botHistory = ['andate a la verga', 'chupame la verga', 'sos un pelotudo', 'callate la verga'];
    const reporte = applyStyleGuard({
      text: 'andate a la verga',
      botHistory,
      userText: 'basta',
    });

    assert.equal(reporte.toneBroke, true);

    const instruccion = buildRephraseInstruction(reporte);
    assert.match(instruccion, /recurso/);
    assert.ok(
      !/dejá la agresión de lado/i.test(instruccion),
      'el guardrail no debe pedirle que deje de insultar'
    );
  });

  test('no se dispara si el mensaje nuevo es neutro', () => {
    const botHistory = ['sos un manco', 'te gano siempre', 'callate vos'];
    const reporte = applyStyleGuard({
      text: 'nada ps, aca',
      botHistory,
      userText: 'que haces',
    });

    assert.equal(reporte.toneBroke, false);
    assert.equal(reporte.needsRephrase, false);
  });

  test('no se dispara con historial corto ni con historial tranquilo', () => {
    const corto = applyStyleGuard({
      text: 'sos un manco',
      botHistory: ['te gano'],
      userText: 'hola',
    });
    assert.equal(corto.toneBroke, false);

    const tranquilo = applyStyleGuard({
      text: 'sos un manco',
      botHistory: ['nada ps', 'aca', 'de una', 'ya fue'],
      userText: 'hola',
    });
    assert.equal(tranquilo.toneBroke, false);
  });
});

describe('styleGuard — eco (no devolver las palabras del usuario)', () => {
  test('detecta la copia literal del caso real', () => {
    assert.equal(isEcho('tenes?', 'tenes?'), true);
    assert.equal(isEcho('pero que haces?', 'pero que haces?'), true);
    assert.equal(isEcho('que haces', 'que haces?'), true);
    assert.equal(isEcho('nada ps', 'que haces?'), false);
  });

  test('un saludo devuelto no se considera eco', () => {
    assert.equal(isEcho('hola', 'hola'), false);
    assert.equal(isEcho('jaja', 'jaja'), false);
    assert.equal(isEcho('dale', 'dale'), false);
  });

  test('detecta el calco parcial, no solo la igualdad', () => {
    assert.equal(isEcho('jugamos blood hoy?', 'jugamos blood hoy?'), true);
    assert.equal(isEcho('dale, jugamos blood', 'jugamos blood?'), false);
    assert.equal(isEcho('ni idea ps', 'no se que hacer hoy'), false);
  });

  test('normaliza antes de comparar (acentos, signos y mayúsculas)', () => {
    assert.equal(normalizeEchoText('  ¿Cómo ESTÁS?  '), 'como estas');
    assert.equal(isEcho('¿Cómo estás?', 'como estas'), true);
  });

  test('el guardrail pide reformular cuando hay eco', () => {
    const reporte = applyStyleGuard({
      text: 'pero que haces?',
      botHistory: [],
      userText: 'pero que haces?',
    });

    assert.equal(reporte.needsRephrase, true);
    assert.equal(reporte.echo?.userText, 'pero que haces?');
    assert.match(buildRephraseInstruction(reporte), /eco/);
  });

  test('sin eco no se dispara la reformulación', () => {
    const reporte = applyStyleGuard({
      text: 'nada ps, aca',
      botHistory: [],
      userText: 'pero que haces?',
    });

    assert.equal(reporte.needsRephrase, false);
    assert.equal(reporte.echo, undefined);
  });
});
