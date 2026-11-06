import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatTemporalPrompt,
  getTemporalContext,
  greetingForPeriod,
  readZonedParts,
  relativeTimeLabel,
  resolveTimeZone,
} from '../services/clock.js';

const TZ = 'America/La_Paz';

describe('clock — conciencia temporal', () => {
  test('jueves 15:30 (La Paz) → tarde y datos de fecha correctos', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T19:30:00Z'), TZ);

    assert.equal(ctx.weekdayName, 'jueves');
    assert.equal(ctx.timeLabel, '15:30');
    assert.equal(ctx.period, 'tarde');
    assert.equal(ctx.periodLabel, 'tarde');
    assert.equal(ctx.isWeekend, false);
    assert.equal(ctx.isSchoolHours, false);
    assert.equal(ctx.isLateNight, false);
    assert.equal(ctx.dateLabel, 'jueves, 24 de septiembre de 2026');
  });

  test('madrugada (03:00) → isLateNight y prompt de sueño', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T07:00:00Z'), TZ);

    assert.equal(ctx.hour, 3);
    assert.equal(ctx.period, 'madrugada');
    assert.equal(ctx.isLateNight, true);
    assert.match(ctx.activityHint, /madrugada/);
  });

  test('mediodía 12:30 → almuerzo', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T16:30:00Z'), TZ);

    assert.equal(ctx.period, 'mediodia');
    assert.equal(ctx.mealLabel, 'almuerzo');
    assert.match(ctx.activityHint, /almorzar/);
  });

  test('lunes 08:15 → horario de colegio', () => {
    const ctx = getTemporalContext(new Date('2026-09-21T12:15:00Z'), TZ);

    assert.equal(ctx.weekdayName, 'lunes');
    assert.equal(ctx.isSchoolHours, true);
    assert.match(ctx.activityHint, /colegio/);
  });

  test('sábado 15:30 → fin de semana sin colegio', () => {
    const ctx = getTemporalContext(new Date('2026-09-26T19:30:00Z'), TZ);

    assert.equal(ctx.weekdayName, 'sábado');
    assert.equal(ctx.isWeekend, true);
    assert.equal(ctx.isSchoolHours, false);
    assert.equal(ctx.isHomeworkHours, false);
  });

  test('viernes 16:00 → horario de tareas (no colegio)', () => {
    const ctx = getTemporalContext(new Date('2026-09-25T20:00:00Z'), TZ);

    assert.equal(ctx.weekdayName, 'viernes');
    assert.equal(ctx.isSchoolHours, false);
    assert.equal(ctx.isHomeworkHours, true);
    assert.match(ctx.activityHint, /tareas/);
  });

  test('readZonedParts devuelve la hora local, no la UTC', () => {
    const parts = readZonedParts(new Date('2026-09-24T19:30:00Z'), TZ);

    assert.equal(parts.hour, 15);
    assert.equal(parts.minute, 30);
    assert.equal(parts.day, 24);
    assert.equal(parts.weekdayIndex, 4);
  });

  test('el prompt temporal inyecta fecha, hora y reglas de coherencia', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T19:30:00Z'), TZ);
    const prompt = formatTemporalPrompt(ctx);

    assert.match(prompt, /RELOJ REAL/);
    assert.match(prompt, /jueves, 24 de septiembre de 2026/);
    assert.match(prompt, /15:30 hs/);
    assert.match(prompt, /America\/La_Paz/);
    assert.match(prompt, /REGLAS DEL RELOJ/);
  });

  test('zona horaria inválida cae a una zona válida sin explotar', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T19:30:00Z'), 'Zona/Inventada');

    assert.ok(ctx.timezone.length > 0);
    assert.match(ctx.timeLabel, /^\d{2}:\d{2}$/);
    assert.equal(resolveTimeZone('Zona/Inventada').includes('/'), true);
  });

  test('relativeTimeLabel expresa el tiempo transcurrido en palabras', () => {
    const now = new Date('2026-09-24T19:30:00Z').getTime();

    assert.equal(relativeTimeLabel(now - 10_000, now), 'recién');
    assert.equal(relativeTimeLabel(now - 5 * 60_000, now), 'hace 5 minutos');
    assert.equal(relativeTimeLabel(now - 60 * 60_000, now), 'hace 1 hora');
    assert.equal(relativeTimeLabel(now - 3 * 3_600_000, now), 'hace 3 horas');
    assert.equal(relativeTimeLabel(now - 2 * 86_400_000, now), 'hace 2 días');
  });

  test('greetingForPeriod no saluda "buenas noches" al mediodía', () => {
    assert.equal(greetingForPeriod('noche'), 'buenas noches');
    assert.equal(greetingForPeriod('mediodia'), 'que tal');
    assert.equal(greetingForPeriod('manana'), 'buenos dias');
  });

  test('Dante jamás tiene horario escolar ni tareas de estudio en la tarde', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T20:00:00Z'), TZ, 'dante');
    assert.equal(ctx.activityHint.includes('tareas'), false);
    assert.equal(ctx.activityHint.includes('colegio'), false);
    assert.match(ctx.activityHint, /partidas|descansando|pedo/);

    const prompt = formatTemporalPrompt(ctx, 'dante');
    assert.equal(prompt.includes('colegio'), false);
    assert.match(prompt, /callejera|jugando|pedo/);
  });

  test('Roxy jamás tiene horario escolar ni tareas en la tarde', () => {
    const ctx = getTemporalContext(new Date('2026-09-24T20:00:00Z'), TZ, 'roxy');
    assert.equal(ctx.activityHint.includes('tareas'), false);
    assert.equal(ctx.activityHint.includes('colegio'), false);
    assert.match(ctx.activityHint, /compu|streams|música|libre/);

    const prompt = formatTemporalPrompt(ctx, 'roxy');
    assert.equal(prompt.includes('colegio'), false);
    assert.match(prompt, /pícara|coqueta/);
  });
});
