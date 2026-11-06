import fs from 'fs';
import os from 'os';
import path from 'path';
import { generatePersonaResponse } from '../services/deepseek.js';
import {
  addMemberFacts,
  appendAmbient,
  buildCrewContext,
  getAmbient,
  getChatMood,
  getMemberRapport,
  getMemoryStats,
  getPromptHistory,
  initMemory,
  upsertMember,
} from '../services/memoryStore.js';
import { buildDeliveryPlan, splitIntoBubbles, typingDelayMs } from '../services/humanizer.js';
import { extractFacts } from '../services/factExtractor.js';
import { getTemporalContext } from '../services/clock.js';
import { formatMoodPrompt, resetMood, updateMood } from '../services/mood.js';
import { formatRapportPrompt, getRapportState, recordRapportSignal } from '../services/rapport.js';
import { buildGroupAmbientPrompt } from '../services/groupContext.js';
import { OutboundRateLimiter } from '../services/rateLimiter.js';
import { applyStyleGuard, buildRephraseInstruction } from '../services/styleGuard.js';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-bot-'));
const TMP_FILE = path.join(TMP_DIR, 'memory.json');

const GRUPO = '120363000000000000@g.us';
const PAEZ = '59170000001';
const CESAR = '59170000002';
const LUIS = '34600000001';

function titulo(texto: string) {
  console.log(`\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
}

async function main() {
  initMemory({ file: TMP_FILE, autosave: true, saveDebounceMs: 50 });

  const reloj = getTemporalContext();
  titulo('RELOJ REAL DEL BOT');
  console.log(`${reloj.dateLabel} — ${reloj.timeLabel} hs (${reloj.timezone})`);
  console.log(`Periodo: ${reloj.periodLabel} | colegio: ${reloj.isSchoolHours} | tareas: ${reloj.isHomeworkHours}`);
  console.log(`Actividad coherente: ${reloj.activityHint}`);

  upsertMember({ id: PAEZ, name: 'Paez', phone: PAEZ, bumpMessageCount: true });
  upsertMember({ id: LUIS, name: 'Luis', phone: '34600000001', isCreator: true, bumpMessageCount: true });

  const mensajePaez = 'hola nicol, jugamos blood? me gusta el sniper y tengo 17 años';
  addMemberFacts(PAEZ, extractFacts(mensajePaez));

  titulo('FICHA DEL CLAN (lo que el bot recuerda)');
  console.log(buildCrewContext([PAEZ, LUIS], PAEZ) || '(vacío)');

  titulo('TURNO 1 — Páez en el grupo del clan NB');
  console.log(`Páez: "${mensajePaez}"`);
  const res1 = await generatePersonaResponse(GRUPO, mensajePaez, undefined, {
    phoneNumber: `+${PAEZ}`,
    name: 'Paez',
    isCreator: false,
    isGroup: true,
    memberId: PAEZ,
    groupMemberIds: [PAEZ, LUIS],
  });
  console.log(`\nNicol: ${res1.textResponse.replace(/\n/g, ' ⏎ ')}${res1.stickerTag ? ` [sticker: ${res1.stickerTag}]` : ''}`);

  const plan1 = buildDeliveryPlan(res1.textResponse, { rng: Math.random });
  console.log(`\nSimulación de envío: ${plan1.bubbles.length} burbuja(s)`);
  plan1.bubbles.forEach((b, i) => {
    console.log(`  ${i + 1}. "${b}" → escribiendo ${(typingDelayMs(b) / 1000).toFixed(1)}s`);
  });
  console.log(`  Pausa inicial de "pensar": ${(plan1.thinkMs / 1000).toFixed(1)}s`);

  titulo('TURNO 2 — Luis en privado (prueba de conciencia temporal)');
  const mensajeLuis = 'oye que hora es? y que estas haciendo?';
  console.log(`Luis: "${mensajeLuis}"`);
  const res2 = await generatePersonaResponse(LUIS, mensajeLuis, undefined, {
    phoneNumber: '+34600000001',
    name: 'Luis',
    isCreator: true,
    isGroup: false,
    memberId: LUIS,
  });
  console.log(`\nNicol: ${res2.textResponse.replace(/\n/g, ' ⏎ ')}${res2.stickerTag ? ` [sticker: ${res2.stickerTag}]` : ''}`);

  const burbujas = splitIntoBubbles(res2.textResponse);
  console.log(`\nSe enviaría en ${burbujas.length} mensaje(s) con tipeo proporcional: ${burbujas.map((b) => `"${b}"`).join(' → ')}`);

  titulo('ESTADO DE ÁNIMO (se detecta del mensaje y queda persistido)');
  const estadoTierna = updateMood({ chatId: GRUPO, text: 'ay nicol te quiero mucho', isGroup: true });
  console.log(`Mensaje: "ay nicol te quiero mucho" → ánimo: ${estadoTierna?.mood ?? 'normal'} (${estadoTierna?.reason})`);
  console.log(`\n${formatMoodPrompt(estadoTierna)}`);

  const estadoEnojada = updateMood({ chatId: GRUPO, text: 'sos una idiota nicol', isGroup: true });
  console.log(`\nMensaje: "sos una idiota nicol" → ánimo: ${estadoEnojada?.mood ?? 'normal'} (${estadoEnojada?.reason})`);

  for (let i = 0; i < 7; i += 1) {
    updateMood({ chatId: GRUPO, text: 'cuentame algo de la vida', isGroup: true });
  }
  console.log(`Tras 7 turnos neutros → ánimo: ${getChatMood(GRUPO)?.mood ?? 'normal (ya se le pasó solo)'}`);

  titulo('VÍNCULO CON CADA PERSONA (define el filo del bardo)');
  upsertMember({ id: CESAR, name: 'Cesar', phone: CESAR, bumpMessageCount: true });
  recordRapportSignal(PAEZ, 'te quiero mucho nicol, sos lo mas');
  recordRapportSignal(CESAR, 'sos una basura, callate');
  console.log(`Paez  → vínculo: ${getRapportState(PAEZ)} (saldo ${getMemberRapport(PAEZ)?.score ?? 0})`);
  console.log(`${formatRapportPrompt(PAEZ, 'Paez')}`);
  console.log(`\nCesar → vínculo: ${getRapportState(CESAR)} (saldo ${getMemberRapport(CESAR)?.score ?? 0})`);
  console.log(`${formatRapportPrompt(CESAR, 'Cesar')}`);

  titulo(' CHISME DEL GRUPO (contexto ambiente sin que le hablen)');
  appendAmbient(GRUPO, { senderName: 'Paez', text: 'che jugamos blood hoy?' });
  appendAmbient(GRUPO, { senderName: 'Cesar', text: 'yo no puedo, tengo que estudiar' });
  appendAmbient(GRUPO, { senderName: 'Alejandro', text: 'los que puedan entran a las 9' });
  const chisme = buildGroupAmbientPrompt(GRUPO);
  console.log(`Mensajes ajenos guardados: ${getAmbient(GRUPO).length}`);
  console.log(`\n${chisme}`);

  titulo(' ANTI-BANEO (límites de salida por chat y globales)');
  const rl = new OutboundRateLimiter({ perMinute: 3, perHour: 20, globalPerMinute: 5, minGapMs: 400 });
  const base = Date.now();
  console.log(`1er mensaje → ${JSON.stringify(rl.check(GRUPO, base))}`);
  rl.record(GRUPO, base);
  console.log(`Inmediato después (rompe el gap) → ${JSON.stringify(rl.check(GRUPO, base + 100))}`);
  rl.record(GRUPO, base + 500);
  rl.record(GRUPO, base + 1000);
  console.log(`Al llegar a 3 en el minuto → ${JSON.stringify(rl.check(GRUPO, base + 1500))}`);

  titulo('GUARDRAIL DE ESTILO (risas medidas + anti-repetición)');
  const historialPropio = ['jajaja que haces', 'jsjsjs dale', 'jajaja nada', 'que haces ps'];
  const reporte = applyStyleGuard({
    text: 'que haces ps jajaja',
    botHistory: historialPropio,
    userText: 'hola nicol',
  });
  console.log(`Respuesta cruda: "que haces ps jajaja"`);
  console.log(`Respuesta final: "${reporte.text}"`);
  console.log(`Tasa de risas medida: ${(reporte.laughRate * 100).toFixed(0)}% | risas recortadas: ${reporte.laughsRemoved}`);
  console.log(`Repetición detectada: ${reporte.repetition ? `"${reporte.repetition.previous}" (${reporte.repetition.score.toFixed(2)})` : 'ninguna'}`);
  if (reporte.needsRephrase) {
    console.log(`\nInstrucción que se le manda al modelo para reformular:\n${buildRephraseInstruction(reporte)}`);
  }

  titulo(' SIMULACIÓN DE REINICIO DEL BOT (memoria en disco)');
  const statsAntes = getMemoryStats();
  console.log(`Antes → chats: ${statsAntes.chats}, miembros: ${statsAntes.members}, mensajes: ${statsAntes.messages}, datos: ${statsAntes.facts}`);
  console.log(`Archivo: ${statsAntes.file} (${statsAntes.sizeKb} KB)`);

  resetMood(GRUPO, true);
  updateMood({ chatId: GRUPO, text: 'estas linda nicol', isGroup: true });

  const grupoAntes = getPromptHistory(GRUPO, 10);
  const privadoAntes = getPromptHistory(LUIS, 10);

  initMemory({ file: TMP_FILE });
  const grupoRehidratado = getPromptHistory(GRUPO, 10);
  const privadoRehidratado = getPromptHistory(LUIS, 10);
  const animoRehidratado = getChatMood(GRUPO);
  const chismeRehidratado = getAmbient(GRUPO).length;

  console.log(`\nDespués del reinicio, historial del grupo (${grupoRehidratado.length} mensajes):`);
  for (const m of grupoRehidratado) {
    console.log(`  [${m.role}] ${m.content}`);
  }
  console.log(`\nHistorial privado con Luis (${privadoRehidratado.length} mensajes): recuperado`);
  console.log(`Ánimo recordado tras reiniciar: ${animoRehidratado?.mood ?? 'ninguno'}`);
  console.log(`Chisme recordado tras reiniciar: ${chismeRehidratado} mensaje(s)`);

  titulo('RESULTADO');
  const checks = [
    ['El modelo respondió y quedó en el historial', grupoAntes.some((m) => m.role === 'assistant')],
    [
      'Memoria persistente del grupo (idéntica tras reiniciar)',
      grupoAntes.length >= 2 && grupoRehidratado.length === grupoAntes.length,
    ],
    [
      'Memoria persistente privada (idéntica tras reiniciar)',
      privadoAntes.length >= 2 && privadoRehidratado.length === privadoAntes.length,
    ],
    ['Ánimo persistido en disco', animoRehidratado?.mood === 'coqueta'],
    ['Chisme del grupo persistido', chismeRehidratado >= 3],
    ['Vínculo cercano (Paez) recordado', getRapportState(PAEZ) === 'cercano'],
    ['Vínculo tenso (Cesar) recordado', getRapportState(CESAR) === 'tenso'],
    ['Risas recortadas por el guardrail', reporte.laughsRemoved > 0],
    ['Anti-baneo cortando la ráfaga', rl.check(GRUPO, base + 1500).allowed === false],
  ] as const;

  for (const [nombre, ok] of checks) {
    console.log(`${ok ? 'ok' : 'FALLA'} ${nombre}`);
  }

  const todoOk = checks.every(([, ok]) => ok);
  console.log(todoOk ? '\nTodo OK: memoria + reloj + ánimo + vínculo + chisme + anti-baneo + estilo funcionando.' : '\nAlguna verificación falló.');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(todoOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Error en la prueba de humo:', err);
  process.exit(1);
});
