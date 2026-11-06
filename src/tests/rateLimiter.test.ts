import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OutboundRateLimiter } from '../services/rateLimiter.js';

const BASE = 1_700_000_000_000;

function limiter(overrides: Partial<ConstructorParameters<typeof OutboundRateLimiter>[0]> = {}) {
  return new OutboundRateLimiter({
    perMinute: 3,
    perHour: 5,
    globalPerMinute: 10,
    minGapMs: 100,
    ...overrides,
  });
}

describe('rateLimiter — anti-baneo de mensajes salientes', () => {
  test('deja pasar el primer mensaje sin espera', () => {
    const rl = limiter();
    const verdict = rl.check('chat@a', BASE);

    assert.equal(verdict.allowed, true);
    assert.equal(verdict.waitMs, 0);
  });

  test('obliga a respetar el espacio mínimo entre mensajes del mismo chat', () => {
    const rl = limiter();
    rl.record('chat@a', BASE);

    const verdict = rl.check('chat@a', BASE + 40);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'gap');
    assert.equal(verdict.waitMs, 60);

    assert.equal(rl.check('chat@a', BASE + 150).allowed, true);
  });

  test('corta la ráfaga cuando pasa el límite por minuto', () => {
    const rl = limiter({ perMinute: 2, minGapMs: 0 });

    rl.record('chat@a', BASE);
    rl.record('chat@a', BASE + 1000);

    const verdict = rl.check('chat@a', BASE + 2000);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'minuto');
    assert.equal(verdict.waitMs, 58_000);

    assert.equal(rl.check('chat@a', BASE + 61_000).allowed, true);
  });

  test('corta cuando pasa el límite por hora', () => {
    const rl = limiter({ perMinute: 100, perHour: 2, minGapMs: 0 });

    rl.record('chat@a', BASE);
    rl.record('chat@a', BASE + 60_000);

    const verdict = rl.check('chat@a', BASE + 120_000);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'hora');
    assert.equal(verdict.waitMs, 3_480_000);
  });

  test('el límite global frena el spam repartido en varios chats', () => {
    const rl = limiter({ perMinute: 100, perHour: 100, globalPerMinute: 2, minGapMs: 0 });

    rl.record('chat@a', BASE);
    rl.record('chat@b', BASE + 10);

    const verdict = rl.check('chat@c', BASE + 20);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'global');

    assert.equal(rl.check('chat@c', BASE + 60_000).allowed, true);
  });

  test('acquire espera lo mínimo y devuelve true', async () => {
    const rl = limiter({ minGapMs: 20 });
    rl.record('chat@a', Date.now());

    const ok = await rl.acquire('chat@a', 500);
    assert.equal(ok, true);
  });

  test('acquire descarta la respuesta si la espera sería enorme', async () => {
    const rl = limiter({ perMinute: 1, minGapMs: 0 });
    rl.record('chat@a', Date.now());
    const ok = await rl.acquire('chat@a', 500);

    assert.equal(ok, false);
  });

  test('snapshot y reset permiten inspeccionar y limpiar el estado', () => {
    const rl = limiter({ minGapMs: 0 });
    rl.record('chat@a', BASE);
    rl.record('chat@a', BASE + 1);

    const snapshot = rl.snapshot('chat@a', BASE + 2);
    assert.equal(snapshot.perMinute, 2);
    assert.equal(snapshot.perHour, 2);
    assert.equal(snapshot.globalPerMinute, 2);

    rl.reset();
    assert.equal(rl.snapshot('chat@a', BASE + 3).perMinute, 0);
  });
});
