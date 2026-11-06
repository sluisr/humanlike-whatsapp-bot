import { config } from '../config.js';
import { logger } from './logger.js';
import { getChatMood, setChatMood, type ChatMoodState, type NicolMood, type RapportStance } from './memoryStore.js';
import type { DayPeriod } from './clock.js';
import { isPlayfulJoke } from './rapport.js';

export type { ChatMoodState, NicolMood };

const MINUTE_MS = 60_000;

interface MoodSpec {
  label: string;
  vibe: string;
  avoid: string;
}

const MOOD_SPECS: Record<NicolMood, MoodSpec> = {
  normal: {
    label: 'NORMAL',
    vibe: 'tu onda de siempre, relajada, con chispa pero sin exagerar',
    avoid: 'no fuerces ningún ánimo, no anuncies cómo estás',
  },
  contenta: {
    label: 'CONTENTA / ENERGÉTICA',
    vibe: 'mensajes más vivos, con más ganas, contestás rápido, se te nota la buena onda',
    avoid: 'no expliques por qué estás contenta ni lo anuncies con "estoy feliz"',
  },
  tierna: {
    label: 'TIERNA / DULCE',
    vibe: 'hablás más suave, con cariño, diminutivos, más emojis y stickers de amor',
    avoid: 'no te vuelvas empalagosa ni exageres el cariño en cada mensaje',
  },
  coqueta: {
    label: 'COQUETA / PICARONA',
    vibe: 'juego, indirectas, doble sentido suave, te hacés la difícil y tirás onda',
    avoid: 'no pases a lo explícito; si el otro insiste de más, te ponés seca',
  },
  enojada: {
    label: 'ENOJADA / COMBATIVA',
    vibe: 'te la devolvés con humor negro e ironía, bardeás con ingenio, te cagás de risa del que te insultó en vez de achicarte',
    avoid: 'no te victimices ni te pongas dramática; el filo exacto depende del vínculo (mirá el bloque de vínculo): con quien te tiene cariño es joda, con quien te faltó el respeto va filoso de verdad. Nunca amenazas ni condiciones: nada de "o te dejo sin...", ni en broma.',
  },
  seca: {
    label: 'SECA / DESGANADA',
    vibe: 'respuestas cortísimas, sin emojis ni stickers, como quien contesta por obligación',
    avoid: 'no des explicaciones largas; si el otro te cae bien te vas ablandando de a poco',
  },
  triste: {
    label: 'BAJONEADA / TRISTE',
    vibe: 'más callada, mensajes cortos, bajás el volumen, respondés con pocas ganas pero no cortante',
    avoid: 'no dramatices ni pidas lástima, tampoco cuentes la razón si no te preguntan',
  },
  estresada: {
    label: 'ESTRESADA',
    vibe: 'apuro, respuestas cortas, menos ganas de charlar',
    avoid: 'no anuncies que estás ocupada ni menciones tareas, colegio ni casa: eso no se cuenta, se nota en lo corta que estás. Si el otro te trae chisme interesante, aflojás un poco',
  },
};

const MOOD_PATTERNS: Array<{ mood: NicolMood; reason: string; regex: RegExp }> = [
  {
    mood: 'enojada',
    reason: 'te faltó el respeto',
    regex: /\b(puta|put[ao]|perra|zorra|tarad[ao]|idiota|imbecil|estupid[ao]|pelotud[ao]|pendej[ao]|cornud[ao]|callate|callate la boca|cierra el orto)\b/iu,
  },
  {
    mood: 'enojada',
    reason: 'te bardeó o te apuró de mala manera',
    regex: /\b(que te pasa|no entendes nada|sos una|sos un|no servis|andate|dejame en paz|no me rompas|rompes las bolas|hinchapelotas)\b/iu,
  },
  {
    mood: 'triste',
    reason: 'te dijo algo que te dolió',
    regex: /\b(me hiciste llorar|me dejaste|no te quiero|ya no te hablo|te odio|me chupa un huevo|no me importas|me fallaste|me mentiste)\b/iu,
  },
  {
    mood: 'tierna',
    reason: 'te dijo algo lindo',
    regex: /\b(te quiero|te amo|te adoro|mi amor|mi vida|gracias|gracias nicol|beso|abrazo|te extrano|te extraño|me haces bien|cuidate|te cuidas)\b/iu,
  },
  {
    mood: 'coqueta',
    reason: 'te tiró onda',
    regex: /\b(estas linda|estas hermosa|linda|hermosa|preciosa|bella|me gustas|te gusto|besos|caliente|rico|rica|morbos|piropo|me pongo nervioso|saldrias conmigo|te puedo llamar)\b/iu,
  },
  {
    mood: 'estresada',
    reason: 'horario de tareas y casa',
    regex: /\b(tarea|tareas|deber|deberes|examen|prueba|estudiar|colegio|clase|profesor|profundizar|limpiar|ordenar|ayudar en casa|me apuran|ya tengo)\b/iu,
  },
  {
    mood: 'contenta',
    reason: 'se habló de algo que te gusta',
    regex: /\b(jugamos|partida|ganamos|blod|blood|free fire|roblox|minecraft|salimos|fiesta|cumple|plan|pizza|helado|vacaciones|viernes|finde)\b/iu,
  },
  {
    mood: 'seca',
    reason: 'te hablaron con pocas ganas',
    regex: /^(ok|oka|okay|d[ae]le|aha|ah[aá]|mmm+|eh+|si|no|.?)$/iu,
  },
];

export interface MoodUpdateInput {
  chatId: string;
  text: string;
  isGroup?: boolean;
  period?: DayPeriod;
  stance?: RapportStance;
  now?: number;
}

export function normalizeForMood(text: string): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectMood(text: string, period?: DayPeriod): { mood: NicolMood; reason: string } | undefined {
  const normalized = normalizeForMood(text);
  if (!normalized) return undefined;

  for (const pattern of MOOD_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { mood: pattern.mood, reason: pattern.reason };
    }
  }

  if (period === 'madrugada') return { mood: 'triste', reason: 'es de madrugada' };
  if (period === 'manana') return { mood: 'estresada', reason: 'es la mañana' };

  return undefined;
}

export function isMoodExpired(state: ChatMoodState, now: number = Date.now()): boolean {
  if (state.mood === 'normal') return true;
  const ttlMs = Math.max(1, config.moodTtlMinutes) * MINUTE_MS;
  if (now - state.updatedAt > ttlMs) return true;
  return state.turns >= Math.max(1, config.moodTtlTurns);
}

export function updateMood(input: MoodUpdateInput): ChatMoodState | undefined {
  if (!config.moodEnabled) return undefined;

  const now = input.now ?? Date.now();
  const previous = getChatMood(input.chatId);
  const detected = detectMood(input.text, input.period);

  if (detected) {
    const esJoda = detected.mood === 'enojada' && isPlayfulJoke(input.text, input.stance ?? 'neutral');
    const moodFinal: NicolMood = esJoda ? 'contenta' : detected.mood;
    const motivo = esJoda ? 'te está jodiendo con cariño y le seguís el juego' : detected.reason;

    const state: ChatMoodState = {
      mood: moodFinal,
      reason: motivo,
      since: previous?.mood === moodFinal ? previous.since : now,
      updatedAt: now,
      turns: 0,
    };
    setChatMood(input.chatId, state, input.isGroup ?? false);
    logger.forensic('MOOD', `Nicol pasó a ${state.mood} (${state.reason})`, {
      chatId: input.chatId,
      anterior: previous?.mood ?? 'ninguno',
      vinculo: input.stance ?? 'neutral',
    });
    return state;
  }

  if (!previous || isMoodExpired(previous, now)) {
    if (previous) setChatMood(input.chatId, undefined, input.isGroup ?? false);
    return undefined;
  }

  const aged: ChatMoodState = { ...previous, turns: previous.turns + 1, updatedAt: previous.updatedAt };
  setChatMood(input.chatId, aged, input.isGroup ?? false);
  return aged;
}

export function getActiveMood(chatId: string, now: number = Date.now()): ChatMoodState | undefined {
  if (!config.moodEnabled) return undefined;
  const state = getChatMood(chatId);
  if (!state || isMoodExpired(state, now)) return undefined;
  return state;
}

export function resetMood(chatId: string, isGroup = false): void {
  setChatMood(chatId, undefined, isGroup);
}

export function formatMoodPrompt(state: ChatMoodState | undefined): string {
  if (!state || state.mood === 'normal') return '';

  const spec = MOOD_SPECS[state.mood];
  if (!spec) return '';

  const turnsLeft = Math.max(0, Math.max(1, config.moodTtlTurns) - state.turns);
  const lines = [
    '[TU ESTADO DE ÁNIMO AHORA MISMO]',
    `Estás ${spec.label}${state.reason ? ` porque ${state.reason}` : ''}.`,
    `Cómo se te nota: ${spec.vibe}.`,
    `Ojo: ${spec.avoid}.`,
    `Te dura pocos mensajes más (${turnsLeft}) y después se te pasa solo: no te claves ni lo anuncies, se nota en cómo escribís.`,
    'REGLA CLAVE: este bloque es información de fondo para tu TONO, no son palabras para escribir. No anuncies cómo estás ni repitas ni cambies de forma estos textos: una persona nunca narra su estado interno. Se te nota en cómo escribís, no en lo que contás.',
  ];

  return lines.join('\n');
}

export function moodLabel(state: ChatMoodState | undefined): string {
  return state ? MOOD_SPECS[state.mood].label : 'NORMAL';
}
