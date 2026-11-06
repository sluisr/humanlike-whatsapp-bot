import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveTargetJid } from '../services/whatsapp.js';

describe('resolveTargetJid — resolución de destinatario real para chats privados y grupos', () => {
  test('deja intactos los chats de grupo (@g.us)', () => {
    assert.equal(resolveTargetJid('123456789-987654@g.us'), '123456789-987654@g.us');
  });

  test('deja intactos los chats privados normales (@s.whatsapp.net)', () => {
    assert.equal(resolveTargetJid('34600000002@s.whatsapp.net'), '34600000002@s.whatsapp.net');
  });

  test('mantiene un @lid intacto para entrega directa nativa en Baileys v7', () => {
    assert.equal(resolveTargetJid('99999999999999@lid', '+34 600 00 00 02'), '99999999999999@lid');
  });

  test('mantiene el LID del creador intacto para entrega directa nativa en Baileys v7', () => {
    const resolved = resolveTargetJid('100000000000001@lid');
    assert.equal(resolved, '100000000000001@lid');
  });
});
