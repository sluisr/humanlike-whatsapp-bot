import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  decayedScore,
  detectRapportSignal,
  formatRapportPrompt,
  getRapportState,
  isPlayfulJoke,
  recordRapportSignal,
  stanceForScore,
} from '../services/rapport.js';
import {
  flushMemory,
  getMemberRapport,
  initMemory,
  resetMemory,
  upsertMember,
} from '../services/memoryStore.js';
import { updateMood } from '../services/mood.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';
import { getTemporalContext } from '../services/clock.js';
import { evaluateStickerBudget } from '../services/stickerBudget.js';

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapport-test-'));
  return path.join(dir, 'memory.json');
}

const GRUPO = '123456@g.us';
const PAEZ = '59170000001';
const CESAR = '59170000002';

describe('rapport — vínculo de Nicol con cada persona', () => {
  let file: string;

  beforeEach(() => {
    file = tempFile();
    initMemory({ file, autosave: false });
    upsertMember({ id: PAEZ, name: 'Paez', phone: PAEZ });
    upsertMember({ id: CESAR, name: 'Cesar', phone: CESAR });
  });

  afterEach(() => {
    resetMemory();
  });

  test('detecta las señales de cariño y de mala onda', () => {
    assert.equal(detectRapportSignal('te quiero mucho nicol')?.delta, 2);
    assert.equal(detectRapportSignal('gracias nicol')?.delta, 2);
    assert.equal(detectRapportSignal('estas linda hoy')?.delta, 1);
    assert.equal(detectRapportSignal('es joda nicol')?.delta, 1);
    assert.equal(detectRapportSignal('sos una idiota')?.delta, -2);
    assert.equal(detectRapportSignal('callate la boca')?.delta, -2);
    assert.equal(detectRapportSignal('che jugamos blood?'), undefined);
  });

  test('sin plata ni historial el vínculo es neutral', () => {
    assert.equal(getRapportState(undefined), 'neutral');
    assert.equal(getRapportState(PAEZ), 'neutral');
    assert.equal(formatRapportPrompt(PAEZ, 'Paez'), '');
  });

  test('el cariño acumulado lo vuelve cercano y el maltrato lo vuelve tenso', () => {
    assert.equal(recordRapportSignal(PAEZ, 'te quiero nicol'), 'cercano');
    assert.equal(getMemberRapport(PAEZ)?.score, 2);

    assert.equal(recordRapportSignal(CESAR, 'sos una idiota'), 'tenso');
    assert.equal(getMemberRapport(CESAR)?.score, -2);

    assert.equal(stanceForScore(0), 'neutral');
    assert.equal(stanceForScore(5), 'cercano');
    assert.equal(stanceForScore(-5), 'tenso');
  });

  test('el vínculo se guarda en disco y sobrevive al reinicio', () => {
    recordRapportSignal(PAEZ, 'gracias nicol');
    recordRapportSignal(PAEZ, 'sos lo mas');
    assert.equal(getMemberRapport(PAEZ)?.score, 4);

    flushMemory();
    initMemory({ file, autosave: false });

    assert.equal(getMemberRapport(PAEZ)?.score, 4);
    assert.equal(getRapportState(PAEZ), 'cercano');
  });

  test('un berrinche se enfría con el tiempo (vida media)', () => {
    const gracia = 60 * 1000;
    const mediaVida = 12 * 60 * 60 * 1000;
    const ahora = Date.now();
    const rapport = { score: 4, stance: 'cercano' as const, updatedAt: ahora, notes: [] };

    assert.equal(decayedScore(rapport, ahora), 4);
    assert.equal(decayedScore(rapport, ahora + gracia - 1), 4);
    assert.ok(Math.abs(decayedScore(rapport, ahora + gracia + mediaVida) - 2) < 0.001);
    assert.ok(decayedScore(rapport, ahora + gracia + mediaVida * 2) < 1.01);
  });

  test('el vínculo justo en el umbral no parpadea por microsegundos', () => {
    recordRapportSignal(PAEZ, 'te quiero mucho');
    const ahora = Date.now();

    assert.equal(getRapportState(PAEZ), 'cercano');
    assert.equal(getRapportState(PAEZ, ahora + 5), 'cercano');
    assert.equal(getRapportState(PAEZ, ahora + 30 * 1000), 'cercano');
    const enfriado = decayedScore({ score: 2, stance: 'cercano', updatedAt: ahora, notes: [] }, ahora + 60 * 60 * 1000);
    assert.ok(enfriado < 2, `esperaba un saldo enfriado, salió ${enfriado}`);
    assert.equal(stanceForScore(enfriado), 'neutral');
  });

  test('el prompt explica el filo según el vínculo', () => {
    recordRapportSignal(PAEZ, 'te quiero mucho');
    const cercano = formatRapportPrompt(PAEZ, 'Paez');
    assert.match(cercano, /\[TU VÍNCULO CON PAEZ\]/);
    assert.match(cercano, /JODA/);
    assert.match(cercano, /devolvéle el golpe con ingenio/i);

    recordRapportSignal(CESAR, 'sos una basura');
    const tenso = formatRapportPrompt(CESAR, 'Cesar');
    assert.match(tenso, /mala onda/);
    assert.match(tenso, /no amenazás de verdad/);
  });

  test('el bloque de vínculo viaja en el system prompt', () => {
    recordRapportSignal(PAEZ, 'te quiero mucho');
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, isCreator: false },
      temporal: getTemporalContext(),
      speakerName: 'Paez',
      historyLength: 2,
      stickerBudget: evaluateStickerBudget(GRUPO),
      rapportPrompt: formatRapportPrompt(PAEZ, 'Paez'),
    });

    assert.match(prompt, /TU VÍNCULO CON PAEZ/);
  });

  test('un insulto en joda de alguien cercano no la enoja, la prende al bardo', () => {
    recordRapportSignal(PAEZ, 'sos lo mas nicol');

    const joda = updateMood({
      chatId: GRUPO,
      text: 'sos una idiota jajaja es joda',
      isGroup: true,
      stance: 'cercano',
    });
    assert.equal(joda?.mood, 'contenta');
    assert.match(joda?.reason ?? '', /jodiendo con cariño/);

    assert.equal(isPlayfulJoke('sos una idiota jajaja es joda', 'cercano'), true);
    assert.equal(isPlayfulJoke('sos una idiota jajaja es joda', 'tenso'), false);
  });

  test('el insulto de alguien con mala onda previa queda como enojo combativo', () => {
    recordRapportSignal(CESAR, 'no servis para nada');

    const enojo = updateMood({
      chatId: GRUPO,
      text: 'sos una idiota',
      isGroup: true,
      stance: 'tenso',
    });
    assert.equal(enojo?.mood, 'enojada');
  });

  test('salir de un vínculo tenso requiere constancia: no se perdona al primer mensaje lindo', () => {
    assert.equal(recordRapportSignal(CESAR, 'sos una idiota'), 'tenso');
    assert.equal(getMemberRapport(CESAR)?.score, -2);

    const primerPaso = recordRapportSignal(CESAR, 'perdon nicol, te quiero mucho');
    assert.equal(primerPaso, 'neutral');
    assert.equal(getMemberRapport(CESAR)?.score, -1);

    const promptRecelo = formatRapportPrompt(CESAR, 'Cesar');
    assert.match(promptRecelo, /Dinámica de reconciliación/);

    const segundoPaso = recordRapportSignal(CESAR, 'sos lo mas');
    assert.equal(segundoPaso, 'neutral');
    assert.equal(getMemberRapport(CESAR)?.score, 0);

    const tercerPaso = recordRapportSignal(CESAR, 'gracias nicol');
    assert.equal(tercerPaso, 'cercano');
  });
});
