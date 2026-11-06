import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  describeStickersForPrompt,
  describeStickersForTool,
  getStickerDir,
  getStickers,
  listCanonicalTags,
  resolveStickerFile,
} from '../services/stickerCatalog.js';
import {
  applyStickerPolicy,
  comboStickerCandidates,
  decideStickerDirective,
  evaluateStickerBudget,
  extractStickerTag,
  formatStickerStatePrompt,
  resolveForcedStickerTag,
  type StickerBudget,
} from '../services/stickerBudget.js';
import { appendTurn, initMemory, resetMemory } from '../services/memoryStore.js';
import { getTemporalContext } from '../services/clock.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';

const CHAT = '123456@g.us';

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickers-test-'));
  return path.join(dir, 'memory.json');
}

function budget(overrides: Partial<StickerBudget> = {}): StickerBudget {
  return {
    window: 6,
    sent: 0,
    total: 0,
    rate: 0,
    target: 0.6,
    directive: 'neutral',
    consecutiveWithSticker: 0,
    ...overrides,
  };
}

describe('stickerCatalog — catálogo real como fuente única de verdad', () => {
  test('todos los stickers del catálogo existen en disco', () => {
    const dir = getStickerDir();
    for (const item of getStickers()) {
      assert.ok(fs.existsSync(path.join(dir, item.file)), `falta el archivo ${item.file}`);
    }
    assert.ok(getStickers().length >= 19);
  });

  test('resuelve un tag exacto al archivo correcto', () => {
    const resolved = resolveStickerFile('beso_amor');
    assert.equal(resolved?.file, 'beso_amor.webp');
    assert.equal(resolved?.tag, 'beso_amor');
    assert.equal(resolved?.emotion, 'amor');
    assert.equal(resolved?.via, 'exacto');
  });

  test('resuelve alias y variantes con tilde', () => {
    assert.equal(resolveStickerFile('besito')?.tag, 'beso_amor');
    assert.equal(resolveStickerFile('CARIÑO')?.tag, 'beso_amor');
    assert.equal(resolveStickerFile('hola')?.tag, 'perrito_pata_feliz');
  });

  test('un tag inventado NO se resuelve (jamás un sticker al azar)', () => {
    assert.equal(resolveStickerFile('zzz_inexistente_zzz'), undefined);
    assert.equal(resolveStickerFile(''), undefined);
    assert.equal(resolveStickerFile('   '), undefined);
  });

  test('la descripción del tool incluye TODOS los tags canónicos (sin listas viejas)', () => {
    const descripcion = describeStickersForTool();
    for (const tag of listCanonicalTags()) {
      assert.ok(descripcion.includes(tag), `la descripción del tool no incluye ${tag}`);
    }
  });

  test('el bloque del prompt agrupa los stickers por emoción legible', () => {
    const bloque = describeStickersForPrompt();
    assert.match(bloque, /Cariño \/ Amor/);
    assert.match(bloque, /beso_amor/);
    assert.match(bloque, /Risas/);
  });
});

describe('stickerBudget — decisión de mandar o no mandar sticker', () => {
  test('sin historial no fuerza nada', () => {
    assert.equal(decideStickerDirective({ sent: 0, total: 0, rate: 0, target: 0.6, consecutiveWithSticker: 0 }), 'neutral');
  });

  test('nunca deja 2 turnos seguidos en modo obligado ni 3 stickers seguidos', () => {
    const base = { sent: 0, total: 5, rate: 0, target: 0.6 };
    assert.equal(decideStickerDirective({ ...base, consecutiveWithSticker: 1 }), 'encouraged');
    assert.equal(decideStickerDirective({ ...base, consecutiveWithSticker: 2 }), 'veto');
    assert.equal(decideStickerDirective({ ...base, consecutiveWithSticker: 3 }), 'veto');
  });

  test('empuja a mandar cuando va por debajo del 60%', () => {
    assert.equal(
      decideStickerDirective({ sent: 0, total: 4, rate: 0, target: 0.6, consecutiveWithSticker: 0 }),
      'must'
    );
    assert.equal(
      decideStickerDirective({ sent: 1, total: 5, rate: 0.2, target: 0.6, consecutiveWithSticker: 0 }),
      'must'
    );
    assert.equal(
      decideStickerDirective({ sent: 3, total: 6, rate: 0.5, target: 0.6, consecutiveWithSticker: 0 }),
      'encouraged'
    );
  });

  test('frena cuando se pasa del 60%', () => {
    assert.equal(
      decideStickerDirective({ sent: 9, total: 10, rate: 0.9, target: 0.6, consecutiveWithSticker: 0 }),
      'restrained'
    );
    assert.equal(
      decideStickerDirective({ sent: 3, total: 5, rate: 0.6, target: 0.6, consecutiveWithSticker: 0 }),
      'neutral'
    );
  });

  test('mide la tasa real leyendo el historial persistido del chat', () => {
    initMemory({ file: tempFile(), autosave: false });
    const conSticker = (texto: string, tag: string) => `${texto} [sticker: ${tag}]`;

    appendTurn(CHAT, { user: 'a', assistant: 'jaja' }, true);
    appendTurn(CHAT, { user: 'b', assistant: conSticker('uy', 'gato_curioso') }, true);
    appendTurn(CHAT, { user: 'c', assistant: 'nada' }, true);
    appendTurn(CHAT, { user: 'd', assistant: conSticker('toma', 'beso_amor') }, true);
    appendTurn(CHAT, { user: 'e', assistant: 'ok' }, true);
    appendTurn(CHAT, { user: 'f', assistant: 'dale' }, true);

    const estado = evaluateStickerBudget(CHAT, { window: 6, targetRate: 0.6 });
    assert.equal(estado.total, 6);
    assert.equal(estado.sent, 2);
    assert.ok(Math.abs(estado.rate - 2 / 6) < 1e-9);
    assert.equal(estado.directive, 'must');
    assert.equal(estado.lastStickerTag, 'beso_amor');
    assert.equal(estado.consecutiveWithSticker, 0);
  });

  test('detecta stickers consecutivos y activa el veto', () => {
    initMemory({ file: tempFile(), autosave: false });
    appendTurn(CHAT, { user: 'a', assistant: 'ay' }, true);
    appendTurn(CHAT, { user: 'b', assistant: 'toma [sticker: feliz_sonrisa]' }, true);
    appendTurn(CHAT, { user: 'c', assistant: 'y [sticker: feliz_contenta]' }, true);

    const estado = evaluateStickerBudget(CHAT, { window: 6, targetRate: 0.6 });
    assert.equal(estado.consecutiveWithSticker, 2);
    assert.equal(estado.directive, 'veto');
  });

  test('sin memoria inicializada no explota', () => {
    resetMemory();
    const estado = evaluateStickerBudget(CHAT);
    assert.equal(estado.total, 0);
    assert.equal(estado.directive, 'neutral');
  });

  test('extrae el tag del historial escrito por el bot', () => {
    assert.equal(extractStickerTag('hola [sticker: beso_amor]'), 'beso_amor');
    assert.equal(extractStickerTag('hola'), undefined);
  });
});

describe('applyStickerPolicy — qué sticker sale y cuál se bloquea', () => {
  test('deja pasar un sticker coherente cuando no hay conflicto', () => {
    const ok = applyStickerPolicy({ rawTag: 'feliz_sonrisa', budget: budget() });
    assert.equal(ok.tag, 'feliz_sonrisa');
    assert.equal(ok.file, 'feliz_sonrisa.webp');
    assert.equal(ok.mandatory, false);
    assert.equal(ok.swappedFrom, undefined);
  });

  test('descarta tags inexistentes en vez de mandar cualquier cosa', () => {
    const decision = applyStickerPolicy({ rawTag: 'pato_bailarin_9000', budget: budget() });
    assert.equal(decision.tag, undefined);
    assert.match(decision.skippedReason ?? '', /inexistente/);
  });

  test('bloquea el tercer sticker consecutivo', () => {
    const decision = applyStickerPolicy({
      rawTag: 'beso_amor',
      budget: budget({ consecutiveWithSticker: 3 }),
    });
    assert.equal(decision.tag, undefined);
    assert.match(decision.skippedReason ?? '', /seguidos/);
  });

  test('bloquea el segundo sticker seguido si es de un momento no obligatorio', () => {
    const bloqueado = applyStickerPolicy({
      rawTag: 'gato_curioso',
      budget: budget({ consecutiveWithSticker: 2 }),
    });
    assert.equal(bloqueado.tag, undefined);

    const permitido = applyStickerPolicy({
      rawTag: 'enojo_golpe',
      budget: budget({ consecutiveWithSticker: 2 }),
    });
    assert.equal(permitido.tag, 'enojo_golpe');
    assert.equal(permitido.mandatory, true);
  });

  test('no repite el mismo sticker: cambia por otro de la misma emoción', () => {
    const decision = applyStickerPolicy({
      rawTag: 'enojo_golpe',
      budget: budget({ lastStickerTag: 'enojo_golpe' }),
    });
    assert.equal(decision.tag, 'enojo_serio');
    assert.equal(decision.swappedFrom, 'enojo_golpe');
    assert.equal(decision.emotion, 'enojo');
  });

  test('si no hay alternativa en su emoción, omite el sticker repetido', () => {
    const decision = applyStickerPolicy({
      rawTag: 'gato_curioso',
      budget: budget({ lastStickerTag: 'gato_curioso' }),
    });
    assert.equal(decision.tag, undefined);
    assert.match(decision.skippedReason ?? '', /repetir/);
  });

  test('sin tag no hay nada que decidir', () => {
    const decision = applyStickerPolicy({ budget: budget() });
    assert.equal(decision.tag, undefined);
    assert.match(decision.skippedReason ?? '', /no pidió sticker/);
  });
});

describe('conciencia de stickers en el prompt', () => {
  const temporal = getTemporalContext(new Date('2026-09-24T19:30:00Z'), 'America/La_Paz');

  test('el bloque de conciencia muestra la tasa real medida', () => {
    const bloque = formatStickerStatePrompt(
      budget({ sent: 2, total: 6, rate: 2 / 6, lastStickerTag: 'beso_amor', consecutiveWithSticker: 1, directive: 'must' })
    );

    assert.match(bloque, /últimos 6 mensajes/i);
    assert.match(bloque, /2 llev/);
    assert.match(bloque, /33%/);
    assert.match(bloque, /60%/);
    assert.match(bloque, /"beso_amor"/);
    assert.match(bloque, /ESTADO DE ESTE TURNO/);
  });

  test('el system prompt incluye el estado de stickers y el catálogo completo', () => {
    const prompt = buildSystemPrompt({
      sender: { isGroup: true, name: 'Paez' },
      temporal,
      speakerName: 'Paez',
      historyLength: 4,
      stickerBudget: budget({ sent: 0, total: 4, rate: 0, directive: 'must' }),
    });

    assert.match(prompt, /CONCIENCIA DE STICKERS/);
    assert.match(prompt, /ESTADO DE ESTE TURNO/);
    assert.match(prompt, /beso_amor/);
    assert.ok(!prompt.includes('undefined'));
  });
});

describe('stickerBudget — integración con la memoria en disco', () => {
  beforeEach(() => {
    initMemory({ file: tempFile(), autosave: false });
  });

  afterEach(() => {
    resetMemory();
  });

  test('tras un reinicio sigue sabiendo cuántos stickers mandó', () => {
    appendTurn(CHAT, { user: 'hola', assistant: 'que tal [sticker: perrito_pata_feliz]' }, true);
    appendTurn(CHAT, { user: 'hola', assistant: 'aca ando' }, true);

    const antes = evaluateStickerBudget(CHAT, { window: 6 });
    assert.equal(antes.sent, 1);
    assert.equal(antes.total, 2);
  });
});

describe('cumplimiento real del presupuesto (el "must" que antes era una promesa vacía)', () => {
  test('no fuerza nada cuando el turno no lo exige', () => {
    for (const directive of ['neutral', 'encouraged', 'restrained', 'veto'] as const) {
      assert.equal(resolveForcedStickerTag(budget({ directive, total: 6 })), undefined, `forzó en ${directive}`);
    }
  });

  test('en estado "must" elige un sticker que existe de verdad', () => {
    const forzado = resolveForcedStickerTag(budget({ directive: 'must', total: 4 }));
    assert.ok(forzado, 'debería elegir un sticker');
    assert.ok(resolveStickerFile(forzado), `"${forzado}" no resuelve a ningún archivo del catálogo`);
  });

  test('nunca repite el último sticker que mandó', () => {
    const candidatos = comboStickerCandidates();
    assert.ok(candidatos.length > 1, 'hacen falta varios candidatos para poder rotar');

    for (const ultimo of candidatos) {
      const forzado = resolveForcedStickerTag(
        budget({ directive: 'must', total: 5, lastStickerTag: ultimo })
      );
      assert.notEqual(forzado, ultimo, `el forzado repitió "${ultimo}"`);
    }
  });

  test('rota entre candidatos en vez de clavar siempre el mismo', () => {
    const vistos = new Set<string>();
    for (let total = 0; total < 6; total++) {
      const forzado = resolveForcedStickerTag(budget({ directive: 'must', total }));
      if (forzado) vistos.add(forzado);
    }
    assert.ok(vistos.size > 1, 'el sticker forzado salió siempre el mismo');
  });

  test('los comodines son de buena onda: nunca drama, enojo ni asco', () => {
    const candidatos = comboStickerCandidates();
    assert.ok(candidatos.length >= 3);

    const permitidas = new Set(['alegria', 'saludo', 'risa']);
    for (const tag of candidatos) {
      const emotion = resolveStickerFile(tag)?.emotion;
      assert.ok(
        permitidas.has(emotion ?? ''),
        `"${tag}" es de emoción "${emotion}" y no sirve de comodín`
      );
    }
  });
});

describe('el "must" ya no se anula a sí mismo en el prompt', () => {
  test('si va por debajo de la tasa le pide el sticker y NO le da la excusa para saltearlo', () => {
    const bloque = formatStickerStatePrompt(budget({ sent: 0, total: 4, rate: 0, directive: 'must' }));

    assert.ok(bloque.includes('ESTADO DE ESTE TURNO'));
    assert.ok(
      !bloque.includes('Si no hay emoción real'),
      'la línea de recato estaba anulando la orden de mandar sticker'
    );
    assert.match(bloque, /mandalo junto a tu texto/i);
  });

  test('cuando ya viene sobrado sí le pide recato', () => {
    const bloque = formatStickerStatePrompt(budget({ sent: 9, total: 10, rate: 0.9, directive: 'restrained' }));

    assert.ok(bloque.includes('Si no hay emoción real'));
    assert.ok(!/mandalo junto a tu texto/i.test(bloque));
  });
});
