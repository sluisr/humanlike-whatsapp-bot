import { connectToWhatsApp } from './services/whatsapp.js';
import { config } from './config.js';
import { logger } from './services/logger.js';
import { flushMemory, getMemoryStats, initMemory } from './services/memoryStore.js';
import { getTemporalContext } from './services/clock.js';

initMemory();

const stats = getMemoryStats();
const temporal = getTemporalContext();

logger.forensic('SYSTEM', 'Iniciando bot de WhatsApp', {
  model: config.deepseekModel,
  baseUrl: config.deepseekBaseUrl,
  triggerPrefix: config.triggerPrefix,
  targetPhone: config.targetPhone,
  memoria: {
    archivo: stats.file,
    persistente: stats.persistent,
    chats: stats.chats,
    miembros: stats.members,
    mensajes: stats.messages,
    datos: stats.facts,
  },
  reloj: {
    ahora: `${temporal.dateLabel} ${temporal.timeLabel} (${temporal.timezone})`,
    periodo: temporal.periodLabel,
    actividad: temporal.activityHint,
  },
  humanizacion: {
    tipeo: config.typingSimulationEnabled,
    msPorCaracter: config.typingMsPerChar,
    rafagas: config.burstEnabled,
    maxMensajes: config.burstMaxMessages,
  },
});

function shutdown(signal: string) {
  logger.info(`${signal} recibido: guardando memoria en disco...`);
  flushMemory();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('beforeExit', () => flushMemory());

connectToWhatsApp().catch((err) => {
  logger.error('Error fatal al iniciar el bot:', err);
});
