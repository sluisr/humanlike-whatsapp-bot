import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  addMemberFacts,
  appendTurn,
  buildCrewContext,
  clearChat,
  findMemberByName,
  flushMemory,
  formatMemberCard,
  getMember,
  getMemoryStats,
  getPromptHistory,
  initMemory,
  normalizeKey,
  resetMemory,
  upsertMember,
} from '../services/memoryStore.js';

function tempFile(name = 'memory.json'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-test-'));
  return path.join(dir, name);
}

describe('memoryStore — memoria persistente en disco', () => {
  let file: string;
  const GRUPO = '123456@g.us';
  const PÁEZ = '59170000001';

  beforeEach(() => {
    file = tempFile();
  });

  afterEach(() => {
    resetMemory();
  });

  test('guarda historial y lo rehidrata tras un reinicio del bot', () => {
    initMemory({ file, autosave: false });
    appendTurn(GRUPO, { user: '(paez en el grupo): hola nicol', assistant: 'que tal paez' }, true);
    appendTurn(GRUPO, { user: '(paez en el grupo): jugamos blood?', assistant: 'de una' }, true);
    flushMemory();

    initMemory({ file, autosave: false });
    const history = getPromptHistory(GRUPO);

    assert.equal(history.length, 4);
    assert.deepEqual(
      history.map((m) => `${m.role}:${m.content}`),
      [
        'user:(paez en el grupo): hola nicol',
        'assistant:que tal paez',
        'user:(paez en el grupo): jugamos blood?',
        'assistant:de una',
      ]
    );

    const stats = getMemoryStats();
    assert.equal(stats.messages, 4);
    assert.equal(stats.groups, 1);
    assert.equal(stats.persistent, true);
  });

  test('el archivo en disco existe y es JSON válido', () => {
    initMemory({ file, autosave: false });
    appendTurn('chat-privado', { user: 'hola', assistant: 'hola' });
    flushMemory();

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.chats['chat-privado']);
    assert.equal(raw.chats['chat-privado'].messages.length, 2);
  });

  test('getPromptHistory respeta el límite y devuelve solo lo reciente', () => {
    initMemory({ file, autosave: false });
    for (let i = 1; i <= 30; i++) {
      appendTurn(GRUPO, { user: `mensaje ${i}` }, true);
    }

    const history = getPromptHistory(GRUPO, 5);
    assert.equal(history.length, 5);
    assert.equal(history[0].content, 'mensaje 26');
    assert.equal(history[4].content, 'mensaje 30');
  });

  test('recorta el historial almacenado según el máximo configurado', () => {
    initMemory({ file, autosave: false, maxStoredMessagesPerChat: 4 });
    for (let i = 1; i <= 6; i++) {
      appendTurn(GRUPO, { user: `m${i}` }, true);
    }

    const stored = getPromptHistory(GRUPO, 50);
    assert.equal(stored.length, 4);
    assert.equal(stored[0].content, 'm3');
    assert.equal(stored[3].content, 'm6');
  });

  test('clearChat borra el historial de un chat concreto', () => {
    initMemory({ file, autosave: false });
    appendTurn(GRUPO, { user: 'hola' }, true);
    appendTurn('otro-chat', { user: 'hola' });

    clearChat(GRUPO);

    assert.deepEqual(getPromptHistory(GRUPO), []);
    assert.equal(getPromptHistory('otro-chat').length, 1);
  });

  test('upsertMember acumula alias, teléfono y contador de mensajes', () => {
    initMemory({ file, autosave: false });

    upsertMember({ id: PÁEZ, name: 'Paez', phone: PÁEZ, bumpMessageCount: true });
    upsertMember({ id: PÁEZ, name: 'páez', bumpMessageCount: true });
    upsertMember({ id: PÁEZ, name: 'Paez Gamer', bumpMessageCount: true });

    const profile = getMember(PÁEZ);
    assert.ok(profile);
    assert.equal(profile.messageCount, 3);
    assert.deepEqual(profile.names, ['Paez', 'Paez Gamer']);
    assert.equal(profile.phone, PÁEZ);
  });

  test('addMemberFacts evita datos duplicados (incluso con distinta tilde)', () => {
    initMemory({ file, autosave: false });
    upsertMember({ id: PÁEZ, name: 'Paez' });

    assert.deepEqual(addMemberFacts(PÁEZ, ['le gusta el pvp']), ['le gusta el pvp']);
    assert.deepEqual(addMemberFacts(PÁEZ, ['Le gusta el PVP', 'tiene 17 años']), ['tiene 17 años']);
    assert.equal(getMember(PÁEZ)?.facts.length, 2);
  });

  test('addMemberFacts ignora miembros inexistentes', () => {
    initMemory({ file, autosave: false });
    assert.deepEqual(addMemberFacts('desconocido', ['le gusta el pvp']), []);
  });

  test('findMemberByName encuentra por alias, sin acentos y por coincidencia parcial', () => {
    initMemory({ file, autosave: false });
    upsertMember({ id: '1', name: 'Alejandro' });
    upsertMember({ id: '2', name: 'César' });

    assert.equal(findMemberByName('alejandro')?.id, '1');
    assert.equal(findMemberByName('cesar')?.id, '2');
    assert.equal(findMemberByName('ale')?.id, '1');
    assert.equal(findMemberByName('nadie'), undefined);
  });

  test('buildCrewContext arma la ficha del clan para el prompt', () => {
    initMemory({ file, autosave: false });
    upsertMember({ id: 'a', name: 'Alejandro' });
    upsertMember({ id: 'p', name: 'Paez' });
    addMemberFacts('p', ['le gusta el pvp', 'tiene 17 años']);

    const crew = buildCrewContext(['a', 'p'], 'yo');

    assert.match(crew, /FICHA DE MEMORIA DE LOS MIEMBROS DE ESTE GRUPO/);
    assert.match(crew, /- Paez: le gusta el pvp; tiene 17 años/);
    assert.match(crew, /- Alejandro/);
    assert.ok(!crew.includes('yo'));
  });

  test('buildCrewContext excluye al interlocutor actual y devuelve vacío sin datos', () => {
    initMemory({ file, autosave: false });
    upsertMember({ id: 'a', name: 'Alejandro' });

    assert.equal(buildCrewContext(['a'], 'a'), '');
    assert.equal(buildCrewContext(['inexistente']), '');
  });

  test('formatMemberCard resume la ficha en texto legible', () => {
    initMemory({ file, autosave: false });
    upsertMember({ id: PÁEZ, name: 'Paez', phone: PÁEZ, bumpMessageCount: true });
    addMemberFacts(PÁEZ, ['le gusta el pvp']);

    const card = formatMemberCard(getMember(PÁEZ)!, Date.now());
    assert.match(card, /Ficha de Paez/);
    assert.match(card, /• Mensajes: 1/);
    assert.match(card, /le gusta el pvp/);
  });

  test('normalizeKey quita acentos y unifica mayúsculas', () => {
    assert.equal(normalizeKey('PÁEZ  Gámez'), 'paez gamez');
    assert.equal(normalizeKey('Alejandro'), 'alejandro');
  });

  test('sin flush() la memoria queda solo en RAM (no ensucia el disco)', () => {
    initMemory({ file, autosave: false });
    appendTurn(GRUPO, { user: 'hola' }, true);

    assert.equal(getPromptHistory(GRUPO).length, 1);
    assert.equal(fs.existsSync(file), false);

    flushMemory();
    assert.equal(fs.existsSync(file), true);
  });

  test('re-inicializar la memoria vuelca lo pendiente sin perder datos', () => {
    initMemory({ file, autosave: true, saveDebounceMs: 5000 });
    appendTurn(GRUPO, { user: '(paez en el grupo): hola', assistant: 'que tal' }, true);

    initMemory({ file, autosave: false });

    assert.equal(getPromptHistory(GRUPO).length, 2);
  });

  test('con autosave activo la memoria se guarda sola (debounce)', async () => {
    initMemory({ file, autosave: true, saveDebounceMs: 10 });
    appendTurn(GRUPO, { user: 'hola', assistant: 'que tal' }, true);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(fs.existsSync(file), true);

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(raw.chats[GRUPO].messages.length, 2);
  });
});
