import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildNicknamePattern,
  decideResponse,
  mentionsBotName,
  normalizeForMatch,
  type TriggerInput,
} from '../services/triggerPolicy.js';

const ALIASES = ['nicol', 'nicole', 'nico', 'val', 'vale', 'flaca', 'chica melon', 'melon'];

function input(overrides: Partial<TriggerInput> = {}): TriggerInput {
  return {
    isGroup: true,
    text: 'hola',
    hasPrefix: false,
    isBotMentioned: false,
    isBotQuoted: false,
    respondToAll: false,
    nicknames: ALIASES,
    ...overrides,
  };
}

describe('triggerPolicy — en privado contesta siempre', () => {
  test('un "oye" suelto en privado se responde igual', () => {
    const decision = decideResponse(input({ isGroup: false, text: 'oye' }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'privado');
  });

  test('en privado no importa si el texto nombra a alguien', () => {
    const decision = decideResponse(input({ isGroup: false, text: 'che mira esto' }));

    assert.equal(decision.respond, true);
  });
});

describe('triggerPolicy — en grupo solo contesta si le hablan a ella', () => {
  test('un "oye" suelto en el grupo no la despierta', () => {
    const decision = decideResponse(input({ text: 'oye' }));

    assert.equal(decision.respond, false);
    assert.equal(decision.reason, 'no-va-dirigido');
  });

  test('la llama por nombre → contesta', () => {
    const decision = decideResponse(input({ text: 'che nico que haces' }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'nombre');
  });

  test('el nombre con acento también cuenta', () => {
    assert.equal(decideResponse(input({ text: 'hola melón' })).respond, true);
  });

  test('el nombre en mayúsculas también cuenta', () => {
    assert.equal(decideResponse(input({ text: 'NICOLE estas?' })).respond, true);
  });

  test('@mención directa → contesta', () => {
    const decision = decideResponse(input({ text: 'hola', isBotMentioned: true }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'mencion-directa');
  });

  test('citando un mensaje suyo → contesta', () => {
    const decision = decideResponse(input({ text: 'y esto?', isBotQuoted: true }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'cita');
  });

  test('con el prefijo de trigger → contesta', () => {
    const decision = decideResponse(input({ text: '!que haces', hasPrefix: true }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'prefijo');
  });

  test('RESPOND_TO_ALL manda aunque no la nombren (antes era una opción muerta)', () => {
    const decision = decideResponse(input({ text: 'eyy' , respondToAll: true }));

    assert.equal(decision.respond, true);
    assert.equal(decision.reason, 'responder-a-todos');
  });

  test('el prefijo le gana a responder-a-todos en el motivo reportado', () => {
    const decision = decideResponse(input({ text: '!hola', hasPrefix: true, respondToAll: true }));

    assert.equal(decision.reason, 'responder-a-todos');
  });
});

describe('triggerPolicy — precisión de los apodos', () => {
  test('no dispara con palabras que contienen el apodo adentro', () => {
    assert.equal(mentionsBotName('valentina viene?', ALIASES), false);
    assert.equal(mentionsBotName('nicolas no vino', ALIASES), false);
  });

  test('detecta el apodo entre signos y comas', () => {
    assert.equal(mentionsBotName('hola, nicol!', ALIASES), true);
    assert.equal(mentionsBotName('(vale) veni', ALIASES), true);
  });

  test('detecta el apodo de dos palabras', () => {
    assert.equal(mentionsBotName('chica melon donde estas', ALIASES), true);
  });

  test('sin apodos configurados no matchea nada', () => {
    assert.equal(buildNicknamePattern([]), null);
    assert.equal(mentionsBotName('nico veni', []), false);
  });

  test('los apodos con caracteres de regex no rompen el patrón', () => {
    assert.equal(mentionsBotName('hola n.n', ['n.n']), true);
    assert.equal(mentionsBotName('hola', ['a(b']), false);
  });

  test('un apodo en blanco se ignora', () => {
    assert.equal(buildNicknamePattern(['   ']), null);
  });

  test('normalizeForMatch saca acentos y mayúsculas', () => {
    assert.equal(normalizeForMatch('Melón NICOLÁS'), 'melon nicolas');
  });
});
