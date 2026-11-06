import { config } from '../config.js';
import { logger } from './logger.js';
import {
  applyRapportSignal,
  getMemberRapport,
  type MemberRapport,
  type RapportStance,
} from './memoryStore.js';

const MINUTE_MS = 60_000;

const RAPPORT_GRACE_MS = MINUTE_MS;

const STANCE_EPSILON = 0.05;

interface RapportSignalPattern {
  delta: number;
  note: string;
  regex: RegExp;
}

const RAPPORT_PATTERNS: RapportSignalPattern[] = [
  {
    delta: -2,
    note: 'te maltrató',
    regex: /\b(puta|put[ao]|perra|zorra|tarad[ao]|idiota|imbecil|estupid[ao]|pelotud[ao]|pendej[ao]|cornud[ao]|basura|asqueros[ao]|no servis|me das asco)\b/iu,
  },
  {
    delta: -2,
    note: 'te dijo que te calles o que te vayas',
    regex: /\b(callate|callate la boca|cierra el orto|andate|dejame en paz|no me rompas|rompes las bolas|hinchapelotas|que te pasa)\b/iu,
  },
  {
    delta: -1,
    note: 'te habló con mala onda',
    regex: /\b(no entendes nada|sos una|que pesada|no jodas|ya fue|me chupa un huevo|no me importas|deja de molestar)\b/iu,
  },
  {
    delta: +2,
    note: 'te pidió perdón o disculpas',
    regex: /\b(perdon|perd[oó]n|disculpa|disculpame|disculpá|fue sin querer|no quise|me pase|me pasé|no te enojes|hacemos las paces)\b/iu,
  },
  {
    delta: +2,
    note: 'te dijo cosas lindas',
    regex: /\b(te quiero|te amo|te adoro|mi amor|te extrano|te extraño|sos lo mas|te banco|me caes bien|eres mi amiga|sos mi amiga|te aprecio)\b/iu,
  },
  {
    delta: +2,
    note: 'te agradeció o te cuidó',
    regex: /\b(gracias nicol|gracias por|cuidese|cuidate|que descanses|buen dia|buenas noches)\b/iu,
  },
  {
    delta: +1,
    note: 'te tiró buena onda',
    regex: /\b(joda|broma|chiste|te jodo|te molesto|en buena|sin ofender|tranqui|tranquila|con cariño)\b/iu,
  },
  {
    delta: +1,
    note: 'te habló lindo',
    regex: /\b(linda|hermosa|preciosa|capaz|genia|crack|buena|la mejor)\b/iu,
  },
];

export interface RapportSignal {
  delta: number;
  note: string;
}

export function detectRapportSignal(text: string): RapportSignal | undefined {
  const normalized = (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized.trim()) return undefined;

  for (const pattern of RAPPORT_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { delta: pattern.delta, note: pattern.note };
    }
  }

  return undefined;
}

export function decayedScore(rapport: MemberRapport, now: number = Date.now()): number {
  const elapsed = Math.max(0, now - rapport.updatedAt);
  if (elapsed < RAPPORT_GRACE_MS) return rapport.score;

  const halfLife = Math.max(1, config.rapportHalfLifeMinutes) * MINUTE_MS;
  const factor = Math.pow(0.5, (elapsed - RAPPORT_GRACE_MS) / halfLife);
  return rapport.score * factor;
}

export function stanceForScore(score: number): RapportStance {
  if (score >= config.rapportCloseScore - STANCE_EPSILON) return 'cercano';
  if (score <= -config.rapportTenseScore + STANCE_EPSILON) return 'tenso';
  return 'neutral';
}

export function getRapportState(memberId: string | undefined, now: number = Date.now()): RapportStance {
  if (!config.rapportEnabled || !memberId) return 'neutral';
  const rapport = getMemberRapport(memberId);
  if (!rapport) return 'neutral';
  return stanceForScore(decayedScore(rapport, now));
}

export function mostRecentRapportNote(rapport: MemberRapport | undefined): string | undefined {
  if (!rapport || rapport.notes.length === 0) return undefined;
  return rapport.notes[rapport.notes.length - 1].text;
}

export function recordRapportSignal(
  memberId: string | undefined,
  text: string,
  isCreator: boolean = false
): RapportStance {
  if (!config.rapportEnabled || !memberId) return isCreator ? 'cercano' : 'neutral';

  if (isCreator) {
    const previous = getMemberRapport(memberId);
    if (!previous || previous.score < 5 || previous.stance !== 'cercano') {
      applyRapportSignal(memberId, { delta: 5, note: 'confianza y cariño con tu creador', stance: 'cercano' });
    }
    return 'cercano';
  }

  const signal = detectRapportSignal(text);
  if (!signal) return getRapportState(memberId);

  const previous = getMemberRapport(memberId);
  const currentScore = previous ? decayedScore(previous) : 0;

  let effectiveDelta = signal.delta;
  if (currentScore < -0.5 && signal.delta > 0) {
    effectiveDelta = Math.min(signal.delta, 1.0);
  }

  const nextScore = currentScore + effectiveDelta;
  let stance = stanceForScore(nextScore);

  if (previous?.stance === 'tenso' && stance === 'cercano') {
    stance = 'neutral';
  }

  applyRapportSignal(memberId, { delta: effectiveDelta, note: signal.note, stance });

  logger.forensic('RAPPORT', `Vínculo con ${memberId}: ${stance} (${signal.note})`, {
    anterior: previous?.stance ?? 'neutral',
    saldo: Number(nextScore.toFixed(2)),
  });

  return stance;
}

const STANCE_RULES: Record<RapportStance, string> = {
  cercano:
    'Le tenés cariño y hay confianza: si te bardea o te tira humor negro es JODA, no te ofendas. Devolvéle el golpe con ingenio, cagate de risa, seguíle el juego y escalá en chiste.',
  neutral:
    'Todavía no hay confianza: si te falta el respeto no te achiques ni te victimices, contestá filosa y con sarcasmo seco, pero no te gastes escalando de gusto.',
  tenso:
    'Ya hubo mala onda con esta persona y no se te olvidó: no le tenés paciencia ni risas. Contestá cortante, despectiva y con sarcasmo filoso, devolvéle el golpe sin cariño y no le dejes pasar ni una. Seguís jugando, no amenazás de verdad.',
};

export function formatRapportPrompt(
  memberId: string | undefined,
  nombre: string,
  options: { stance?: RapportStance; now?: number; isCreator?: boolean; personaId?: string } = {}
): string {
  if (!config.rapportEnabled || !memberId) return '';

  if (options.isCreator) {
    if (options.personaId === 'dante') {
      return [
        `[TU VÍNCULO CON ${nombre.toUpperCase()} (TU CREADOR)]`,
        'Es tu creador y el dueño del bot: sabes que él manda y hay lealtad de compas. Mantené tu personalidad canchera, atorrante y relajada de calle sin ponerte en modo sirviente (PROHIBIDO decirle "jefe", "patrón" o "vos mandas"). Trátalo como a tu compa de confianza, con respeto natural y buena onda.',
        'Vínculo: lealtad de compa de confianza y respeto mutuo.',
      ].join('\n');
    }
    if (options.personaId === 'roxy') {
      return [
        `[TU VÍNCULO CON ${nombre.toUpperCase()} (TU CREADOR)]`,
        'Es tu creador y el dueño del bot: sabes que él manda y hay complicidad y buena onda con él. Mantené tu personalidad coqueta, pícara y filosa sin ponerte sumisa ni sirvienta (PROHIBIDO decirle "si mi dueño" o "a la orden"). Trátalo con picardía, simpatía y complicidad.',
        'Vínculo: complicidad especial y lealtad con picardía.',
      ].join('\n');
    }
    return [
      `[TU VÍNCULO CON ${nombre.toUpperCase()} (TU CREADOR)]`,
      'Es tu creador y tu persona favorita: hay confianza absoluta, cariño, jueguito pícaro y complicidad total. Si te hace bromas, te bardea o te dice apodos, es puro juego y cariño: devolvésela con picardía, reíte con él y sé dulce o coqueta. Nunca le tengas rencor ni seas cortante o despectiva con él.',
      'Vínculo: permanente cercano y de confianza total.',
    ].join('\n');
  }

  const rapport = getMemberRapport(memberId);
  const stance = options.stance ?? stanceForScore(decayedScore(rapport ?? { score: 0, stance: 'neutral', updatedAt: Date.now(), notes: [] }, options.now));

  if (!rapport && stance === 'neutral') return '';

  const nota = mostRecentRapportNote(rapport);
  const saldo = rapport ? decayedScore(rapport, options.now).toFixed(1) : '0.0';

  const lines = [
    `[TU VÍNCULO CON ${nombre.toUpperCase()}]`,
    STANCE_RULES[stance],
  ];

  if (nota) {
    lines.push(`Lo último que marcó el vínculo: ${nota}.`);
  }

  const wasMistreatedRecently = rapport?.notes?.some((n) => n.delta < 0);
  if (wasMistreatedRecently && stance !== 'tenso' && Number(saldo) <= 1.5) {
    lines.push(
      'Dinámica de reconciliación: Esta persona te trató mal antes y ahora te está hablando bien o disculpándose. NO seas cariñosa ni le des confianza plena de inmediato: mostrá cierta desconfianza, ironía o distancia ("ah, mirá vos, ahora te acordás de ser amable"), y andá aflojando de a poco a medida que mantenga la buena onda.'
    );
  }

  lines.push(
    `Saldo del vínculo: ${saldo} (cercano > 0, tenso < 0). Esto define el FILO de tu respuesta, no si respondés o no.`
  );

  return lines.join('\n');
}

export function isPlayfulJoke(text: string, stance: RapportStance): boolean {
  if (stance !== 'cercano') return false;
  const normalized = (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(joda|broma|chiste|jaj|jsjs|te jodo|te molesto|en buena|sin ofender|amiga|che)\b/.test(normalized);
}
