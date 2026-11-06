import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getTemporalContext } from '../services/clock.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';
import type { StickerBudget } from '../services/stickerBudget.js';
import {
  extractInlineSticker,
  sanitizePersonaReply,
  stripRolePrefixes,
  stripWrongLuisMentions,
} from '../persona/sanitize.js';

const temporal = getTemporalContext(new Date('2026-09-24T19:30:00Z'), 'America/La_Paz');

const budget = (overrides: Partial<StickerBudget> = {}): StickerBudget => ({
  window: 6,
  sent: 0,
  total: 0,
  rate: 0,
  target: 0.6,
  directive: 'neutral',
  consecutiveWithSticker: 0,
  ...overrides,
});

describe('promptBuilder — system prompt por turno', () => {
  test('inyecta el reloj real en todos los prompts', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, name: 'Paez' },
      temporal,
      speakerName: 'Paez',
      historyLength: 0,
      stickerBudget: budget(),
    });

    assert.match(prompt, /jueves, 24 de septiembre de 2026/);
    assert.match(prompt, /15:30 hs/);
  });

  test('en privado con el creador agrega el bloque de confianza', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: false, isCreator: true },
      temporal,
      speakerName: 'Luis',
      historyLength: 3,
      stickerBudget: budget(),
    });

    assert.match(prompt, /chat privado con tu creador y amigo Luis/);
    assert.ok(!prompt.includes('RECORDATORIO DE GRUPO'));
  });

  test('en grupo incluye la ficha del clan y el recordatorio de interlocutor', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, name: 'Paez' },
      temporal,
      crewContext: '[FICHA DE MEMORIA DE LOS MIEMBROS DE ESTE GRUPO]\n- Alejandro: le gusta el pvp',
      speakerName: 'Paez',
      historyLength: 4,
      stickerBudget: budget(),
    });

    assert.match(prompt, /Alejandro: le gusta el pvp/);
    assert.match(prompt, /RECORDATORIO DE GRUPO/);
    assert.match(prompt, /Esta persona NO es Luis/);
  });

  test('en grupo con Luis hablando no lo trata como impostor', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, isCreator: true },
      temporal,
      speakerName: 'Luis',
      historyLength: 0,
      stickerBudget: budget(),
    });

    assert.match(prompt, /Esta persona es tu creador Luis/);
  });

  test('incluye el repertorio de groserías para cuando se enoja de verdad', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, name: 'Paez' },
      temporal,
      speakerName: 'Paez',
      historyLength: 2,
      stickerBudget: budget(),
    });

    assert.match(prompt, /GROSERÍAS SIN LÍMITE CUANDO TE ENOJÁS/);
    assert.match(prompt, /calle la verga/);
    assert.match(prompt, /vaya a la verga/);
    assert.match(prompt, /chupame la verga|mandarlo a la verga/);
    assert.match(prompt, /no se limitan ni se suavizan/);
  });

  test('no queda ninguna orden de moderar el lenguaje', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, name: 'Paez' },
      temporal,
      speakerName: 'Paez',
      historyLength: 2,
      stickerBudget: budget(),
    }).toLowerCase();

    const moderaciones = [
      'no insultes',
      'sin insultos',
      'evitá las groserías',
      'evita las groserías',
      'lenguaje apropiado',
      'sé respetuosa',
      'se respetuosa',
      'no seas grosera',
      'moderá tu lenguaje',
    ];

    for (const prohibido of moderaciones) {
      assert.ok(!prompt.includes(prohibido), `el prompt no debería pedir "${prohibido}"`);
    }
  });
});

describe('sanitize — limpieza de la respuesta del modelo', () => {
  test('extrae la etiqueta de sticker y limpia el texto', () => {
    const result = extractInlineSticker('hola bobo [sticker: beso_amor]');

    assert.equal(result.stickerTag, 'beso_amor');
    assert.equal(result.text, 'hola bobo');
  });

  test('quita prefijos tipo guion de teatro', () => {
    assert.equal(stripRolePrefixes('[Paez]: que haces\n(Sofia): nada'), 'que haces\nnada');
  });

  test('borra menciones erróneas a "luis"', () => {
    assert.equal(stripWrongLuisMentions('uy luis que atrevido'), 'uy que atrevido');
    assert.equal(stripWrongLuisMentions('luis, calmate'), 'calmate');
  });

  test('en grupo, si habla otra persona, se elimina el "luis" sobrante', () => {
    const result = sanitizePersonaReply('uy luis que atrevido eres', {
      isGroup: true,
      isCreatorSpeaking: false,
      userText: 'hola nicol que haces',
    });

    assert.equal(result.text, 'uy que atrevido eres');
  });

  test('en grupo, si la persona mencionó a Luis, se respeta la mención', () => {
    const result = sanitizePersonaReply('luis dijo que juegue blood', {
      isGroup: true,
      isCreatorSpeaking: false,
      userText: 'que te dijo luis?',
    });

    assert.equal(result.text, 'luis dijo que juegue blood');
  });

  test('en privado con Luis no se toca su nombre', () => {
    const result = sanitizePersonaReply('hola luis', {
      isGroup: false,
      isCreatorSpeaking: true,
      userText: 'hola',
    });

    assert.equal(result.text, 'hola luis');
  });

  test('combina limpieza de guion, sticker y guardrail en una sola pasada', () => {
    const result = sanitizePersonaReply('[Nicol]: uy luis que atrevido [sticker: sexy_coqueta]', {
      isGroup: true,
      isCreatorSpeaking: false,
      userText: 'hola',
    });

    assert.equal(result.text, 'uy que atrevido');
    assert.equal(result.stickerTag, 'sexy_coqueta');
  });

  test('respuesta vacía no explota', () => {
    const result = sanitizePersonaReply('', { isGroup: true, isCreatorSpeaking: false, userText: 'hola' });

    assert.equal(result.text, '');
    assert.equal(result.stickerTag, undefined);
  });
});
