import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  getStickers,
  getStickerPolicy,
  resolveStickerFile,
  describeStickersForTool,
  describeStickersForPrompt,
} from '../services/stickerCatalog.js';
import { getPersona } from '../persona/personas.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';
import { evaluateStickerBudget } from '../services/stickerBudget.js';

import { getTemporalContext } from '../services/clock.js';

describe('stickers_duo — Catálogo y stickers exclusivos para Dante y Roxy', () => {
  const duoDir = path.join(process.cwd(), 'assets', 'stickers_duo');
  const nicolDir = path.join(process.cwd(), 'assets', 'stickers');

  it('el directorio assets/stickers_duo contiene exactamente 31 archivos .webp', () => {
    const files = fs.readdirSync(duoDir).filter((f) => f.endsWith('.webp'));
    assert.equal(files.length, 31, 'Debe haber 31 archivos webp en assets/stickers_duo');
  });

  it('todos los stickers en el catálogo de Dante/Roxy existen en disco', () => {
    const stickers = getStickers('dante');
    assert.equal(stickers.length, 31, 'Dante debe tener exactamente 31 stickers');

    for (const item of stickers) {
      const fullPath = path.join(duoDir, item.file);
      assert.ok(fs.existsSync(fullPath), `El sticker ${item.file} debe existir en ${duoDir}`);
    }
  });

  it('Roxy comparte el mismo catálogo de 31 stickers que Dante', () => {
    const roxyStickers = getStickers('roxy');
    assert.equal(roxyStickers.length, 31);
    const danteStickers = getStickers('dante');
    assert.deepEqual(roxyStickers.map((s) => s.file), danteStickers.map((s) => s.file));
  });

  it('separación estricta: Nicol NO tiene acceso a los stickers de Dante/Roxy', () => {
    const nicolStickers = getStickers('nicol');
    const duoStickers = getStickers('dante');

    const nicolFiles = new Set(nicolStickers.map((s) => s.file));
    const duoFiles = new Set(duoStickers.map((s) => s.file));

    for (const file of duoFiles) {
      assert.equal(nicolFiles.has(file), false, `El sticker ${file} no debe pertenecer a Nicol`);
    }

    assert.equal(resolveStickerFile('mirada_morbo', 'nicol'), undefined);
    assert.equal(resolveStickerFile('morder_labio', 'nicol'), undefined);
    assert.equal(resolveStickerFile('dedo_ofensivo', 'nicol'), undefined);
    assert.equal(resolveStickerFile('lanzar_tomate', 'nicol'), undefined);
  });

  it('separación estricta: Dante y Roxy NO usan los stickers de Nicol', () => {
    const nicolStickers = getStickers('nicol');
    const duoStickers = getStickers('dante');

    const duoFiles = new Set(duoStickers.map((s) => s.file));

    for (const item of nicolStickers) {
      assert.equal(duoFiles.has(item.file), false, `El sticker de Nicol ${item.file} no debe estar en Dante/Roxy`);
    }

    assert.equal(resolveStickerFile('abrumado_estres', 'dante'), undefined);
    assert.equal(resolveStickerFile('perrito_pata', 'roxy'), undefined);
    assert.equal(resolveStickerFile('colapso', 'dante'), undefined);
  });

  it('resuelve tags canónicos y alias en Dante y Roxy', () => {
    const res1 = resolveStickerFile('besito', 'dante');
    assert.ok(res1);
    assert.equal(res1?.file, 'besito.webp');

    const res2 = resolveStickerFile('morder_labio', 'roxy');
    assert.ok(res2);
    assert.equal(res2?.file, 'morder_labio_mujer.webp');

    const res3 = resolveStickerFile('fuck_you', 'dante');
    assert.ok(res3);
    assert.equal(res3?.file, 'dedo_ofensivo.webp');

    const res4 = resolveStickerFile('gato_lengua', 'roxy');
    assert.ok(res4);
    assert.equal(res4?.file, 'git_gato_lengua_morbo.webp');
  });

  it('el prompt del sistema para Dante incluye ÚNICAMENTE sus 31 stickers', () => {
    const budget = evaluateStickerBudget('test-chat', {}, 'dante');
    const prompt = buildSystemPrompt({
      speakerName: 'Carlos',
      historyLength: 0,
      personaId: 'dante',
      temporal: getTemporalContext(),
      stickerBudget: budget,
    });

    assert.ok(prompt.includes('morder_labio'));
    assert.ok(prompt.includes('dedo_ofensivo'));
    assert.ok(prompt.includes('mirada_morbo'));
    assert.ok(!prompt.includes('perro_bailando'));
    assert.ok(!prompt.includes('sexy_coqueta'));
  });

  it('el prompt del sistema para Nicol incluye ÚNICAMENTE sus 19 stickers originales', () => {
    const budget = evaluateStickerBudget('test-chat', {}, 'nicol');
    const prompt = buildSystemPrompt({
      speakerName: 'Carlos',
      historyLength: 0,
      personaId: 'nicol',
      temporal: getTemporalContext(),
      stickerBudget: budget,
    });

    assert.ok(prompt.includes('perro_bailando'));
    assert.ok(prompt.includes('sexy_coqueta'));
    assert.ok(!prompt.includes('morder_labio'));
    assert.ok(!prompt.includes('dedo_ofensivo'));
    assert.ok(!prompt.includes('mirada_morbo'));
  });

  it('describeStickersForTool genera listas separadas según la personalidad', () => {
    const nicolTool = describeStickersForTool('nicol');
    const danteTool = describeStickersForTool('dante');

    assert.ok(nicolTool.includes('perro_bailando'));
    assert.ok(!nicolTool.includes('mirada_morbo'));

    assert.ok(danteTool.includes('mirada_morbo'));
    assert.ok(!danteTool.includes('perro_bailando'));
  });
});
