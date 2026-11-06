import { config } from '../config.js';

export type DayPeriod = 'madrugada' | 'manana' | 'mediodia' | 'tarde' | 'noche';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekdayIndex: number;
}

export interface TemporalContext {
  iso: string;
  timezone: string;
  dateLabel: string;
  timeLabel: string;
  weekdayName: string;
  period: DayPeriod;
  periodLabel: string;
  hour: number;
  minute: number;
  minutesOfDay: number;
  isWeekend: boolean;
  isSchoolHours: boolean;
  isHomeworkHours: boolean;
  isLateNight: boolean;
  mealLabel?: 'desayuno' | 'almuerzo' | 'cena';
  activityHint: string;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const PERIOD_LABELS: Record<DayPeriod, string> = {
  madrugada: 'madrugada',
  manana: 'mañana',
  mediodia: 'mediodía',
  tarde: 'tarde',
  noche: 'noche',
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  zonedFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function resolveTimeZone(timeZone: string = config.timezone): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch (_) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }
}

export function readZonedParts(date: Date, timeZone: string = config.timezone): ZonedParts {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedFormatter(tz).formatToParts(date);
  const pick = (type: string): number => {
    const value = parts.find((p) => p.type === type)?.value ?? '0';
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour') % 24;
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute: pick('minute'),
    second: pick('second'),
    weekdayIndex,
  };
}

function isBetween(minutes: number, fromHour: number, fromMinute: number, toHour: number, toMinute: number): boolean {
  const from = fromHour * 60 + fromMinute;
  const to = toHour * 60 + toMinute;
  return minutes >= from && minutes <= to;
}

function resolvePeriod(hour: number): DayPeriod {
  if (hour >= 0 && hour < 6) return 'madrugada';
  if (hour < 12) return 'manana';
  if (hour < 14) return 'mediodia';
  if (hour < 19) return 'tarde';
  return 'noche';
}

function resolveMeal(minutesOfDay: number): TemporalContext['mealLabel'] {
  if (isBetween(minutesOfDay, 7, 0, 8, 45)) return 'desayuno';
  if (isBetween(minutesOfDay, 12, 0, 13, 45)) return 'almuerzo';
  if (isBetween(minutesOfDay, 19, 15, 21, 0)) return 'cena';
  return undefined;
}

function buildActivityHint(input: {
  period: DayPeriod;
  isWeekend: boolean;
  isSchoolHours: boolean;
  isHomeworkHours: boolean;
  isLateNight: boolean;
  mealLabel?: TemporalContext['mealLabel'];
  personaId?: string;
}): string {
  if (input.personaId === 'dante') {
    if (input.isLateNight) {
      return 'es de madrugada. Estás despierto viciando a algún juego o tirado en la cama con sueño. Dato de fondo: contestás cortito.';
    }
    if (input.mealLabel === 'almuerzo') {
      return 'estás comiendo algo al mediodía tranqui. Dato de fondo: no des explicaciones largas.';
    }
    if (input.mealLabel === 'desayuno') {
      return 'recién levantado o tomando algo. Dato de fondo: tono de recién despierto.';
    }
    if (input.mealLabel === 'cena') {
      return 'estás cenando algo en tu casa tranqui.';
    }
    if (input.period === 'tarde') {
      return 'estás al pedo en la pieza jugando unas partidas en la compu/play, o descansando escuchando música. Dato de fondo: relajado.';
    }
    if (input.period === 'noche') {
      return 'estás en tu casa de noche al pedo con los pibes en Discord, jugando unas partidas o mirando algo. Dato de fondo: relajado.';
    }
    if (input.period === 'mediodia') {
      return 'estás al pedo en tu casa a media mañana o mediodía.';
    }
    return 'estás al pedo en tu casa tranqui con el celu en la mano.';
  }

  if (input.personaId === 'roxy') {
    if (input.isLateNight) {
      return 'es de madrugada. Estás despierta viciando o tirada con el celu en la cama con sueño. Dato de fondo: contestás cortito.';
    }
    if (input.mealLabel === 'almuerzo') {
      return 'estás almorzando algo tranqui.';
    }
    if (input.mealLabel === 'desayuno') {
      return 'despertando tranqui, tomando algo.';
    }
    if (input.mealLabel === 'cena') {
      return 'estás cenando en casa tranqui.';
    }
    if (input.period === 'tarde') {
      return 'estás libre en casa, jugando a la compu, escuchando música o viendo streams. Dato de fondo: relajada.';
    }
    if (input.period === 'noche') {
      return 'estás viciando, charlando en Discord o relajada en la cama con el celu. Dato de fondo: relajada.';
    }
    if (input.period === 'mediodia') {
      return 'estás en tu casa a media mañana o mediodía relajada.';
    }
    return 'estás en casa tranqui con el celu en la mano.';
  }

  if (input.isLateNight) {
    return 'es de madrugada. Dato de fondo para tu tono: tenés sueño, contestás corto y seco. No lo anuncies ni lo expliques.';
  }
  if (input.isSchoolHours) {
    return 'estás en clases de tu colegio/facultad. Dato de fondo para tu tono (cortita y ocupada). NO es un tema de conversación: no lo menciones ni lo uses de excusa.';
  }
  if (input.mealLabel === 'almuerzo') {
    return 'estás en plena hora de almorzar con tu familia. Dato de fondo para tu tono: no lo anuncies por tu cuenta.';
  }
  if (input.mealLabel === 'desayuno') {
    return 'estás recién levantando y desayunando. Dato de fondo: tu tono es de recién despierta, no lo narres.';
  }
  if (input.mealLabel === 'cena') {
    return 'estás cenando en casa. Dato de fondo: tranquila, mensajes cortos, sin anunciarlo.';
  }
  if (input.isHomeworkHours) {
    return 'estás en casa haciendo tus tareas de estudio. Dato de fondo: contestá corto. No saques el tema de las tareas por tu cuenta.';
  }
  if (input.period === 'tarde') {
    return 'estás libre en tu casa por la tarde (podés estar tendiendo ropa, escuchando música o jugando "blod"). Dato de fondo: no lo narres.';
  }
  if (input.period === 'noche') {
    return 'estás en casa de noche, relajada con el celu o jugando "blod" con el clan NB. Dato de fondo: no lo anuncies.';
  }
  if (input.period === 'mediodia') {
    return 'estás en casa a media mañana/mediodía. Dato de fondo para tu tono, no lo menciones.';
  }
  if (input.isWeekend) {
    return 'es fin de semana: estás en casa tranquila, sin clases. Dato de fondo, no lo anuncies.';
  }
  return 'estás en casa tranquila con el celu en la mano. Dato de fondo, no lo narres.';
}

export function getTemporalContext(
  date: Date = new Date(),
  timeZone: string = config.timezone,
  personaId?: string
): TemporalContext {
  const tz = resolveTimeZone(timeZone);
  const parts = readZonedParts(date, tz);
  const minutesOfDay = parts.hour * 60 + parts.minute;

  const isWeekend = parts.weekdayIndex === 0 || parts.weekdayIndex === 6;
  const isWeekday = !isWeekend;
  const period = resolvePeriod(parts.hour);
  const isLateNight = parts.hour >= 0 && parts.hour < 6;
  const mealLabel = resolveMeal(minutesOfDay);

  const isSchoolHours = isWeekday && isBetween(minutesOfDay, 7, 30, 12, 15);
  const isHomeworkHours = isWeekday && isBetween(minutesOfDay, 14, 30, 19, 0);

  const weekdayName = WEEKDAYS[parts.weekdayIndex] ?? 'día';
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    iso: date.toISOString(),
    timezone: tz,
    dateLabel: `${weekdayName}, ${parts.day} de ${MONTHS[parts.month - 1] ?? ''} de ${parts.year}`,
    timeLabel: `${pad(parts.hour)}:${pad(parts.minute)}`,
    weekdayName,
    period,
    periodLabel: PERIOD_LABELS[period],
    hour: parts.hour,
    minute: parts.minute,
    minutesOfDay,
    isWeekend,
    isSchoolHours,
    isHomeworkHours,
    isLateNight,
    mealLabel,
    activityHint: buildActivityHint({
      period,
      isWeekend,
      isSchoolHours,
      isHomeworkHours,
      isLateNight,
      mealLabel,
      personaId,
    }),
  };
}

export function formatTemporalPrompt(context: TemporalContext, personaId?: string): string {
  const energyRule = personaId === 'dante'
    ? '- Adapta tu energía al momento del día: en la madrugada contestás cortito medio dormido o viciando, de tarde relajado jugando o al pedo, de noche con chispa callejera.'
    : personaId === 'roxy'
    ? '- Adapta tu energía al momento del día: en la madrugada con sueño, de tarde relajada viciando o con música, de noche pícara y activa.'
    : '- Adapta tu energía al momento del día: en la madrugada seca y con sueño, en el colegio rápida y oculta, de noche relajada.';

  return [
    '[RELOJ REAL — CONCIENCIA DE HORA, DÍA Y CONTEXTO]',
    `Ahora mismo es ${context.dateLabel} y son las ${context.timeLabel} hs (${context.timezone}). Estás en la ${context.periodLabel}.`,
    `Contexto real tuyo en este momento: ${context.activityHint}`,
    'REGLAS DEL RELOJ:',
    '- Si te preguntan la hora, el día o la fecha, responde con ese dato real (no lo inventes).',
    '- No digas que es de noche si es mediodía, ni que te vas a dormir si es de tarde. Sé coherente con el momento.',
    energyRule,
    '- TODO ESTO ES CONTEXTO DE FONDO PARA TU TONO, NO UN TEMA: no anuncies la hora, ni lo que estás haciendo, ni dónde estás, salvo que te lo pregunten directo. Sacar el tema por tu cuenta ("estoy ocupado", "es que estoy haciendo X", etc.) es lo que más delata a un bot.',
  ].join('\n');
}

export function relativeTimeLabel(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;

  const months = Math.floor(days / 30);
  return `hace ${months} mes${months === 1 ? '' : 'es'}`;
}

export function greetingForPeriod(period: DayPeriod): string {
  switch (period) {
    case 'madrugada':
      return 'que haces despierta';
    case 'manana':
      return 'buenos dias';
    case 'mediodia':
    case 'tarde':
      return 'que tal';
    case 'noche':
      return 'buenas noches';
    default:
      return 'que tal';
  }
}
