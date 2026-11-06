import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MessageQueueService, type AggregatedMessage, type SenderMetadata } from '../services/messageQueue.js';

const sender: SenderMetadata = { name: 'Luis', isCreator: true, isGroup: false };

function item(text: string): AggregatedMessage {
  return {
    chatId: 'chat@lid',
    senderKey: 'luis',
    sender,
    fullText: text,
    originalMsg: {} as any,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('messageQueue — el anti-baneo ya no pierde mensajes', () => {
  test('reprograma la respuesta frenada en vez de descartarla', async () => {
    const queue = new MessageQueueService();
    const seen: string[] = [];
    queue.registerHandler(async (msg) => {
      seen.push(msg.fullText);
    });

    assert.equal(queue.defer(item('yaya que vas hacer despues?'), 60), true);
    await sleep(150);

    assert.deepEqual(seen, ['yaya que vas hacer despues?']);
  });

  test('fusiona lo que llega mientras espera el cupo (una sola respuesta)', async () => {
    const queue = new MessageQueueService();
    const seen: string[] = [];
    queue.registerHandler(async (msg) => {
      seen.push(msg.fullText);
    });

    queue.defer(item('che'), 80);
    queue.defer(item('y vos?'), 80);
    await sleep(260);

    assert.deepEqual(seen, ['che\ny vos?']);
  });

  test('deja de reprogramar cuando agota los intentos', () => {
    const queue = new MessageQueueService();
    queue.registerHandler(async () => {});

    assert.equal(queue.defer(item('1'), 5_000), true);
    assert.equal(queue.defer(item('2'), 5_000), true);
    assert.equal(queue.defer(item('3'), 5_000), true);
    assert.equal(queue.defer(item('4'), 5_000), false);
  });

  test('no contesta antes de que venza el cupo', async () => {
    const queue = new MessageQueueService();
    let calls = 0;
    queue.registerHandler(async () => {
      calls += 1;
    });

    queue.defer(item('hola?'), 200);
    await sleep(80);
    assert.equal(calls, 0, 'todavía no venció el cupo');

    await sleep(260);
    assert.equal(calls, 1, 'contestó al liberarse el cupo');
  });

  test('clearChat limpia el cupo pendiente', async () => {
    const queue = new MessageQueueService();
    let calls = 0;
    queue.registerHandler(async () => {
      calls += 1;
    });

    queue.defer(item('hola?'), 150);
    queue.clearChat('chat@lid');
    await sleep(280);

    assert.equal(calls, 0, 'lo pendiente se descartó al limpiar el chat');
  });
});
