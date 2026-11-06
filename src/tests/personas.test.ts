import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPersonalityMenu, getPersona, PERSONAS } from '../persona/personas.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';
import { getTemporalContext } from '../services/clock.js';
import { evaluateStickerBudget } from '../services/stickerBudget.js';
import { clearChat, getChatPersona, setChatPersona } from '../services/memoryStore.js';

describe('multi-persona — catálogo de 3 personalidades', () => {
  test('las 3 personalidades están registradas con sus datos completos', () => {
    assert.ok(PERSONAS.nicol);
    assert.ok(PERSONAS.dante);
    assert.ok(PERSONAS.roxy);

    assert.equal(getPersona('nicol').name, 'Nicol');
    assert.equal(getPersona('dante').name, 'Dante');
    assert.equal(getPersona('roxy').name, 'Roxy');
    assert.equal(getPersona('desconocido').name, 'Nicol');
  });

  test('el menú muestra las 3 opciones y marca la activa', () => {
    const menuNicol = buildPersonalityMenu('nicol');
    assert.match(menuNicol, /Nicol.*activa/);
    assert.match(menuNicol, /Dante/);
    assert.match(menuNicol, /Roxy/);

    const menuDante = buildPersonalityMenu('dante');
    assert.match(menuDante, /Dante.*activa/);
  });

  test('buildSystemPrompt adopta el prompt de la personalidad elegida', () => {
    const temporal = getTemporalContext();
    const stickerBudget = evaluateStickerBudget('test-chat');

    const promptDante = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'dante',
      temporal,
      stickerBudget,
    });
    assert.match(promptDante, /Dante/);
    assert.match(promptDante, /diavlo/i);

    const promptRoxy = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'roxy',
      temporal,
      stickerBudget,
    });
    assert.match(promptRoxy, /Roxy/);
    assert.match(promptRoxy, /seductora/i);
  });

  test('el dueño (Luis) tiene poder total sobre Dante y Roxy en privado y en grupo', () => {
    const temporal = getTemporalContext();
    const budget = evaluateStickerBudget('test-chat');

    const dantePrivate = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'dante',
      sender: { isCreator: true, isGroup: false },
      temporal,
      stickerBudget: budget,
    });
    assert.match(dantePrivate, /DUEÑO/);
    assert.match(dantePrivate, /mando y autoridad/i);

    const danteGroup = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'dante',
      sender: { isCreator: true, isGroup: true },
      temporal,
      stickerBudget: budget,
    });
    assert.match(danteGroup, /DUEÑO/);
    assert.match(danteGroup, /PODER, MANDO Y AUTORIDAD/i);

    const roxyPrivate = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'roxy',
      sender: { isCreator: true, isGroup: false },
      temporal,
      stickerBudget: budget,
    });
    assert.match(roxyPrivate, /DUEÑO/);
    assert.match(roxyPrivate, /poder, control y dominio/i);

    const roxyGroup = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'roxy',
      sender: { isCreator: true, isGroup: true },
      temporal,
      stickerBudget: budget,
    });
    assert.match(roxyGroup, /DUEÑO/);
    assert.match(roxyGroup, /PODER, MANDO Y AUTORIDAD/i);

    const nicolPrivate = buildSystemPrompt({
      speakerName: 'Luis',
      historyLength: 0,
      personaId: 'nicol',
      sender: { isCreator: true, isGroup: false },
      temporal,
      stickerBudget: budget,
    });
    assert.match(nicolPrivate, /amigo/i);
    assert.doesNotMatch(nicolPrivate, /DUEÑO/);
  });

  test('la personalidad NO es global: es independiente por chat/grupo y por defecto Nicol', () => {
    const chatGrupoA = 'test-isolated-grupo-a@g.us';
    const chatPrivadoB = 'test-isolated-privado-b@s.whatsapp.net';
    const chatGrupoC = 'test-isolated-grupo-c@g.us';
    const chatNuevo = 'test-isolated-nuevo@s.whatsapp.net';

    assert.equal(getChatPersona(chatGrupoA), 'nicol');
    assert.equal(getChatPersona(chatPrivadoB), 'nicol');
    assert.equal(getChatPersona(chatNuevo), 'nicol');

    setChatPersona(chatGrupoA, 'dante', true);
    assert.equal(getChatPersona(chatGrupoA), 'dante');
    assert.equal(getChatPersona(chatPrivadoB), 'nicol', 'El chat privado B debe seguir siendo Nicol');
    assert.equal(getChatPersona(chatGrupoC), 'nicol', 'El grupo C debe seguir siendo Nicol');
    assert.equal(getChatPersona(chatNuevo), 'nicol', 'Cualquier chat nuevo debe seguir siendo Nicol');

    setChatPersona(chatPrivadoB, 'roxy', false);
    assert.equal(getChatPersona(chatPrivadoB), 'roxy');
    assert.equal(getChatPersona(chatGrupoA), 'dante', 'Grupo A sigue siendo Dante');
    assert.equal(getChatPersona(chatGrupoC), 'nicol', 'Grupo C sigue siendo Nicol');
    assert.equal(getChatPersona(chatNuevo), 'nicol', 'Chat nuevo sigue siendo Nicol');
  });

  test('clearChat preserva la personalidad activa del chat sin reiniciar a Nicol', () => {
    const chatConDante = 'test-clear-persistencia@g.us';
    setChatPersona(chatConDante, 'dante', true);
    assert.equal(getChatPersona(chatConDante), 'dante');

    clearChat(chatConDante);
    assert.equal(getChatPersona(chatConDante), 'dante', 'La personalidad debe seguir siendo Dante tras /clear');

    const chatConRoxy = 'test-clear-roxy@s.whatsapp.net';
    setChatPersona(chatConRoxy, 'roxy', false);
    assert.equal(getChatPersona(chatConRoxy), 'roxy');

    clearChat(chatConRoxy);
    assert.equal(getChatPersona(chatConRoxy), 'roxy', 'La personalidad debe seguir siendo Roxy tras /clear');
  });
});
