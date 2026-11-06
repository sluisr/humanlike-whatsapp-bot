import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildDeliveryPlan,
  deliverHumanized,
  mergeRandomly,
  resolveHumanizerOptions,
  splitIntoBubbles,
  typingDelayMs,
  type DeliveryAdapter,
} from '../services/humanizer.js';
import { config } from '../config.js';

const rngFijo = () => 0.5;

interface Registro {
  eventos: string[];
  sleeps: number[];
}

function crearAdapter(registro: Registro): DeliveryAdapter {
  return {
    sendPresence: async (state) => {
      registro.eventos.push(`presence:${state}`);
    },
    sendText: async (text, opts) => {
      registro.eventos.push(`texto:${opts.first ? 'first' : 'normal'}:${text}`);
    },
  };
}

function crearRegistro(): Registro & { sleep: (ms: number) => Promise<void> } {
  const registro: Registro = { eventos: [], sleeps: [] };
  return Object.assign(registro, {
    sleep: async (ms: number) => {
      registro.sleeps.push(ms);
      registro.eventos.push(`sleep:${ms}`);
    },
  });
}

describe('humanizer — tipeo humano y ráfagas', () => {
  test('el tiempo de tipeo crece con la longitud del texto', () => {
    const corto = typingDelayMs('hola', { rng: rngFijo, minTypingMs: 1 });
    const largo = typingDelayMs('hola'.repeat(20), { rng: rngFijo, minTypingMs: 1 });

    assert.ok(largo > corto, `esperado ${largo} > ${corto}`);
  });

  test('respeta los topes mínimo y máximo de tipeo', () => {
    assert.equal(typingDelayMs('a', { rng: rngFijo, minTypingMs: 900, maxTypingMs: 5000 }), 900);
    assert.equal(typingDelayMs('x'.repeat(5000), { rng: rngFijo, minTypingMs: 600, maxTypingMs: 8000 }), 8000);
  });

  test('texto vacío no consume tiempo de tipeo', () => {
    assert.equal(typingDelayMs('   ', { rng: rngFijo }), 0);
  });

  test('separa la respuesta en ráfagas usando los saltos de línea del modelo', () => {
    assert.deepEqual(splitIntoBubbles('oye\nsabes que?\nnada que ver che', { rng: rngFijo }), [
      'oye',
      'sabes que?',
      'nada que ver che',
    ]);
  });

  test('parte un mensaje muy largo en varias burbujas', () => {
    const texto =
      'eeh pues nada, estaba en la casa tendiendo ropa y despues me puse a hacer las tareas del colegio, ' +
      'y luego mis amigos me llamaron para jugar blood strike toda la noche, pero me dio sueño y me dormi temprano';

    const burbujas = splitIntoBubbles(texto, { rng: rngFijo, longBubbleChars: 110 });
    assert.ok(burbujas.length > 1, 'debía partirse en varias burbujas');
    assert.ok(burbujas.every((b) => b.length > 0));
    assert.equal(burbujas.join(' ').replace(/\s+/g, ' '), texto.replace(/\s+/g, ' '));
  });

  test('nunca supera el máximo de burbujas configurado', () => {
    const texto = Array.from({ length: 10 }, (_, i) => `mensaje numero ${i}`).join('\n');
    const burbujas = splitIntoBubbles(texto, { rng: rngFijo, maxBubbles: 3 });

    assert.equal(burbujas.length, 3);
  });

  test('con maxBubbles=1 se manda todo junto (ráfagas desactivadas)', () => {
    assert.deepEqual(splitIntoBubbles('oye\nsabes que', { rng: rngFijo, maxBubbles: 1 }), ['oye\nsabes que']);
  });

  test('texto vacío devuelve una entrega vacía', async () => {
    const registro = crearRegistro();
    const resultado = await deliverHumanized(crearAdapter(registro), '   ', { sleep: registro.sleep });

    assert.equal(resultado.sentBubbles, 0);
    assert.equal(registro.eventos.length, 0);
  });

  test('buildDeliveryPlan calcula burbujas, tipeo y pausas coherentes', () => {
    const plan = buildDeliveryPlan('oye\nque haces\nnada', {
      rng: rngFijo,
      msPerChar: 50,
      minTypingMs: 600,
      minThinkMs: 100,
      maxThinkMs: 100,
    });

    assert.equal(plan.bubbles.length, 3);
    assert.equal(plan.thinkMs, 100);
    assert.equal(plan.typingMs.length, 3);
    assert.equal(plan.gapMs.length, 2);
    assert.ok(plan.typingMs.every((ms) => ms >= 600));
  });

  test('deliverHumanized alterna composing → pausa → mensaje por cada burbuja', async () => {
    const registro = crearRegistro();
    const resultado = await deliverHumanized(crearAdapter(registro), 'oye\nque haces', {
      rng: rngFijo,
      sleep: registro.sleep,
      minThinkMs: 100,
      maxThinkMs: 100,
      minBubbleGapMs: 200,
      maxBubbleGapMs: 200,
      msPerChar: 50,
    });

    assert.equal(resultado.sentBubbles, 2);
    assert.deepEqual(
      registro.eventos.map((e) => e.split(':')[0]),
      ['sleep', 'presence', 'sleep', 'presence', 'texto', 'sleep', 'presence', 'sleep', 'presence', 'texto']
    );
    assert.equal(registro.eventos[1], 'presence:composing');
    assert.equal(registro.eventos[3], 'presence:paused');
    assert.equal(registro.eventos[4], 'texto:first:oye');
    assert.equal(registro.eventos[9], 'texto:normal:que haces');
    assert.equal(registro.sleeps[0], 100, 'la primera espera es el "pensar"');
    assert.equal(registro.sleeps[2], 200, 'entre burbujas hay una pausa');
  });

  test('el total reportado coincide con la suma de esperas', async () => {
    const registro = crearRegistro();
    const resultado = await deliverHumanized(crearAdapter(registro), 'hola\nque tal', {
      rng: rngFijo,
      sleep: registro.sleep,
      minThinkMs: 100,
      maxThinkMs: 100,
    });

    const suma = registro.sleeps.reduce((acc, ms) => acc + ms, 0);
    assert.equal(resultado.totalMs, suma);
    assert.equal(resultado.composedMs, resultado.typingMs.reduce((acc, ms) => acc + ms, 0));
  });

  test('el ritmo por defecto es rápido: un mensaje corto no pasa de ~1,5s de espera', () => {
    const plan = buildDeliveryPlan('oye\nque haces', { rng: rngFijo });

    assert.ok(plan.thinkMs <= 400, `pensar demasiado lento: ${plan.thinkMs}ms`);
    assert.ok(
      plan.typingMs.every((ms) => ms <= 1500),
      `tipeo demasiado lento: ${plan.typingMs.join(', ')}ms`
    );
    assert.ok(
      plan.gapMs.every((ms) => ms <= 450),
      `pausa entre burbujas demasiado larga: ${plan.gapMs.join(', ')}ms`
    );
  });

  test('el modo instantáneo no espera nada en absoluto', () => {
    const plan = buildDeliveryPlan('hola\nque tal\nnada mas', { instant: true });

    assert.equal(plan.thinkMs, 0);
    assert.ok(plan.typingMs.every((ms) => ms === 0));
    assert.ok(plan.gapMs.every((ms) => ms === 0));
    assert.equal(plan.bubbles.length, 3, 'igual separa las burbujas');
  });

  test('en modo instantáneo la entrega no duerme nada (ni composing)', async () => {
    const registro = crearRegistro();
    const resultado = await deliverHumanized(crearAdapter(registro), 'hola\nque tal', {
      instant: true,
      sleep: registro.sleep,
    });

    assert.equal(resultado.totalMs, 0);
    assert.equal(resultado.composedMs, 0);
    assert.ok(registro.sleeps.every((ms) => ms === 0));
    assert.ok(!registro.eventos.some((e) => e.startsWith('presence')), 'no debe marcar "escribiendo"');
  });

  test('los tiempos por defecto salen de la config (ajustables por .env)', () => {
    const opts = resolveHumanizerOptions();

    assert.equal(opts.msPerChar, config.typingMsPerChar);
    assert.equal(opts.minThinkMs, config.typingThinkMinMs);
    assert.equal(opts.maxBubbleGapMs, config.bubbleGapMaxMs);
    assert.equal(opts.maxStickerPauseMs, config.stickerPauseMaxMs);
  });
});

describe('humanizer — la ráfaga ya no es siempre igual', () => {
  test('con probabilidad alta la ráfaga se une en un solo mensaje', () => {
    assert.deepEqual(mergeRandomly(['oye', 'que haces', 'nada'], 1, () => 0), ['oye que haces nada']);
  });

  test('con probabilidad 0 no toca nada', () => {
    assert.deepEqual(mergeRandomly(['oye', 'que haces'], 0, () => 0), ['oye', 'que haces']);
  });

  test('funde o no según el azar: la misma entrada da salidas distintas', () => {
    const textos = ['oye', 'sabes que', 'nada'];

    assert.deepEqual(mergeRandomly(textos, 0.9, () => 0.1), ['oye sabes que nada']);
    assert.deepEqual(mergeRandomly(textos, 0.9, () => 0.95), textos);
  });

  test('una sola burbuja no se toca nunca', () => {
    assert.deepEqual(mergeRandomly(['hola'], 1, () => 0), ['hola']);
    assert.deepEqual(mergeRandomly([], 1, () => 0), []);
  });

  test('el plan de entrega respeta la fusión (menos burbujas y menos pausas)', () => {
    const plan = buildDeliveryPlan('oye\nque haces', { mergeChance: 1, rng: rngFijo });

    assert.equal(plan.bubbles.length, 1, 'se unieron las dos líneas');
    assert.equal(plan.typingMs.length, 1);
    assert.equal(plan.gapMs.length, 0, 'sin pausa entre burbujas inexistentes');
  });

  test('la fusión no pierde ni una palabra', () => {
    const plan = buildDeliveryPlan('oye\nque haces\nnada que ver', {
      mergeChance: 1,
      rng: rngFijo,
      maxBubbles: 4,
    });

    assert.equal(plan.bubbles.length, 1);
    assert.equal(plan.bubbles[0].replace(/\s+/g, ' '), 'oye que haces nada que ver');
  });

  test('por defecto no fusiona: el comportamiento previo queda intacto', () => {
    const plan = buildDeliveryPlan('oye\nque haces', { rng: rngFijo });

    assert.equal(plan.bubbles.length, 2);
  });
});
