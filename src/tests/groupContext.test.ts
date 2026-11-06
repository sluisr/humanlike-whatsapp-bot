import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  appendAmbient,
  clearAmbient,
  flushMemory,
  getAmbient,
  initMemory,
  resetMemory,
} from '../services/memoryStore.js';
import { buildGroupAmbientPrompt } from '../services/groupContext.js';

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiente-test-'));
  return path.join(dir, 'memory.json');
}

const GRUPO = '123456@g.us';

describe('groupContext — memoria ambiente del grupo (el chisme)', () => {
  let file: string;

  beforeEach(() => {
    file = tempFile();
    initMemory({ file, autosave: false });
  });

  afterEach(() => {
    resetMemory();
  });

  test('sin mensajes ajenos no se inyecta contexto', () => {
    assert.equal(buildGroupAmbientPrompt(GRUPO), '');
    assert.deepEqual(getAmbient(GRUPO), []);
  });

  test('guarda lo que se habló en el grupo y lo formatea para el prompt', () => {
    appendAmbient(GRUPO, { senderName: 'Paez', text: 'jugamos blood?' });
    appendAmbient(GRUPO, { senderName: 'Cesar', text: 'de una, entro en 5' });

    const bloque = buildGroupAmbientPrompt(GRUPO);

    assert.match(bloque, /\[LO QUE SE VIENE HABLANDO EN EL GRUPO\]/);
    assert.match(bloque, /- Paez \(/);
    assert.match(bloque, /jugamos blood\?/);
    assert.match(bloque, /- Cesar \(/);
    assert.match(bloque, /NO respondas a estos mensajes/);
  });

  test('el chisme sobrevive al reinicio del bot', () => {
    appendAmbient(GRUPO, { senderName: 'Alejandro', text: 'nos juntamos el sabado' });
    flushMemory();
    initMemory({ file, autosave: false });

    const ambient = getAmbient(GRUPO);
    assert.equal(ambient.length, 1);
    assert.equal(ambient[0].text, 'nos juntamos el sabado');
  });

  test('excluye el mensaje que ya se le pasa como turno actual', () => {
    appendAmbient(GRUPO, { senderName: 'Paez', text: 'hola nicol' });

    const bloque = buildGroupAmbientPrompt(GRUPO, { excludeText: 'hola nicol' });
    assert.equal(bloque, '');
  });

  test('no guarda duplicados consecutivos ni textos vacíos', () => {
    appendAmbient(GRUPO, { senderName: 'Paez', text: 'dale' });
    appendAmbient(GRUPO, { senderName: 'Paez', text: 'dale' });
    appendAmbient(GRUPO, { senderName: 'Paez', text: '   ' });

    assert.equal(getAmbient(GRUPO).length, 1);
  });

  test('mantiene solo la ventana reciente del chisme', () => {
    for (let i = 1; i <= 30; i += 1) {
      appendAmbient(GRUPO, { senderName: 'Cesar', text: `mensaje ${i}` });
    }

    const ambient = getAmbient(GRUPO);
    assert.ok(ambient.length <= 12);
    assert.equal(ambient[ambient.length - 1].text, 'mensaje 30');
  });

  test('clearAmbient limpia el contexto del grupo', () => {
    appendAmbient(GRUPO, { senderName: 'Paez', text: 'algo' });
    clearAmbient(GRUPO);

    assert.deepEqual(getAmbient(GRUPO), []);
  });
});
