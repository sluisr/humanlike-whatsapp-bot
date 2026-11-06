import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { config } from '../config.js';
import {
  detectMood,
  formatMoodPrompt,
  getActiveMood,
  isMoodExpired,
  moodLabel,
  normalizeForMood,
  resetMood,
  updateMood,
} from '../services/mood.js';
import { flushMemory, getChatMood, initMemory, resetMemory } from '../services/memoryStore.js';

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mood-test-'));
  return path.join(dir, 'memory.json');
}

const PRIVADO = '34600000001@s.whatsapp.net';
const GRUPO = '123456@g.us';

describe('mood — estado de ánimo persistente de Nicol', () => {
  let file: string;

  beforeEach(() => {
    file = tempFile();
    initMemory({ file, autosave: false });
  });

  afterEach(() => {
    resetMemory();
  });

  test('normaliza el texto (sin acentos ni mayúsculas)', () => {
    assert.equal(normalizeForMood('  TE QUIERO, ¿Cómo ESTÁS?  '), 'te quiero, ¿como estas?');
  });

  test('detecta cada tipo de ánimo a partir del mensaje', () => {
    assert.equal(detectMood('sos una idiota')?.mood, 'enojada');
    assert.equal(detectMood('callate la boca')?.mood, 'enojada');
    assert.equal(detectMood('me hiciste llorar')?.mood, 'triste');
    assert.equal(detectMood('te quiero mucho nicol')?.mood, 'tierna');
    assert.equal(detectMood('estas hermosa hoy')?.mood, 'coqueta');
    assert.equal(detectMood('tengo tarea para mañana')?.mood, 'estresada');
    assert.equal(detectMood('jugamos una partida?')?.mood, 'contenta');
    assert.equal(detectMood('ok')?.mood, 'seca');
    assert.equal(detectMood('cuentame algo de la vida'), undefined);
  });

  test('el ánimo se guarda en la memoria y sobrevive al reinicio del bot', () => {
    const estado = updateMood({ chatId: PRIVADO, text: 'te quiero mucho nicol' });
    assert.equal(estado?.mood, 'tierna');
    assert.equal(getChatMood(PRIVADO)?.mood, 'tierna');

    flushMemory();
    initMemory({ file, autosave: false });

    const rehidratado = getChatMood(PRIVADO);
    assert.equal(rehidratado?.mood, 'tierna');
    assert.match(formatMoodPrompt(rehidratado), /TIERNA/);
  });

  test('el ánimo se pasa solo después de varios turnos sin pistas', () => {
    updateMood({ chatId: PRIVADO, text: 'te amo nicol' });
    assert.equal(getChatMood(PRIVADO)?.mood, 'tierna');

    const neutro = 'cuentame algo de la vida';
    for (let i = 0; i < config.moodTtlTurns + 1; i += 1) {
      updateMood({ chatId: PRIVADO, text: neutro });
    }

    assert.equal(getChatMood(PRIVADO), undefined);
    assert.equal(getActiveMood(PRIVADO), undefined);
  });

  test('un ánimo viejo expira por tiempo aunque no hablen', () => {
    const ahora = Date.now();
    updateMood({ chatId: PRIVADO, text: 'me gustas', now: ahora });
    const estado = getChatMood(PRIVADO);
    assert.equal(estado?.mood, 'coqueta');

    const enUnaHora = ahora + 60 * 60 * 1000;
    assert.equal(isMoodExpired(estado!, enUnaHora), true);
    assert.equal(getActiveMood(PRIVADO, enUnaHora), undefined);
  });

  test('un mensaje que bardeó pisa el ánimo anterior', () => {
    updateMood({ chatId: PRIVADO, text: 'te quiero' });
    assert.equal(getChatMood(PRIVADO)?.mood, 'tierna');

    updateMood({ chatId: PRIVADO, text: 'sos una tarada' });
    assert.equal(getChatMood(PRIVADO)?.mood, 'enojada');
    assert.equal(moodLabel(getChatMood(PRIVADO)), 'ENOJADA / COMBATIVA');
  });

  test('cada chat tiene su propio ánimo', () => {
    updateMood({ chatId: PRIVADO, text: 'estas linda', isGroup: false });
    updateMood({ chatId: GRUPO, text: 'sos una idiota', isGroup: true });

    assert.equal(getChatMood(PRIVADO)?.mood, 'coqueta');
    assert.equal(getChatMood(GRUPO)?.mood, 'enojada');
  });

  test('el bloque de prompt explica el ánimo y avisa que se le pasa', () => {
    const estado = updateMood({ chatId: PRIVADO, text: 'tengo tarea y examen' });
    const bloque = formatMoodPrompt(estado);

    assert.match(bloque, /\[TU ESTADO DE ÁNIMO AHORA MISMO\]/);
    assert.match(bloque, /ESTRESADA/);
    assert.match(bloque, /se te pasa solo/);
  });

  test('sin ánimo vigente no se inyecta ningún bloque', () => {
    assert.equal(formatMoodPrompt(undefined), '');

    updateMood({ chatId: PRIVADO, text: 'te quiero' });
    resetMood(PRIVADO);
    assert.equal(getChatMood(PRIVADO), undefined);
    assert.equal(formatMoodPrompt(getActiveMood(PRIVADO)), '');
  });

  test('el horario empuja un ánimo suave cuando el texto no tiene pistas', () => {
    assert.equal(detectMood('algo tranquilo', 'madrugada')?.mood, 'triste');
    assert.equal(detectMood('algo tranquilo', 'manana')?.mood, 'estresada');
    assert.equal(detectMood('algo tranquilo', 'tarde'), undefined);
  });
});
