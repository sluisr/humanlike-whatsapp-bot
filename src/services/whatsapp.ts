import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  WAMessage,
  WASocket,
  proto,
  type CacheStore,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { generatePersonaResponse, clearHistory } from './deepseek.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { messageQueue } from './messageQueue.js';
import { deliverHumanized, stickerPauseMs, type DeliveryAdapter } from './humanizer.js';
import { outboundLimiter } from './rateLimiter.js';
import { resetMood } from './mood.js';
import {
  addMemberFacts,
  appendAmbient,
  applyRapportSignal,
  clearAmbient,
  findMemberByName,
  formatMemberCard,
  getChatPersona,
  getMember,
  getMemoryStats,
  setChatPersona,
  setChatTitle,
  upsertMember,
} from './memoryStore.js';
import { extractFacts } from './factExtractor.js';
import { getStickerDir, resolveStickerFile } from './stickerCatalog.js';
import { replaceMentions } from './mentions.js';
import { decideResponse } from './triggerPolicy.js';
import { buildPersonalityMenu, getPersona, type PersonaId } from '../persona/personas.js';

let sock: WASocket | null = null;
let isConnecting = false;
const botStartTime = Date.now();
const processedMessageIds = new Set<string>();
const botSentMessageIds = new Set<string>();

function markBotSent(id?: string | null) {
  if (!id) return;
  botSentMessageIds.add(id);
  if (botSentMessageIds.size > 5000) {
    const first = botSentMessageIds.values().next().value;
    if (first) botSentMessageIds.delete(first);
  }
}

const messagesStore = new Map<string, proto.IMessage>();

function storeMessage(keyId?: string | null, message?: proto.IMessage | null) {
  if (!keyId || !message) return;
  messagesStore.set(keyId, message);
  if (messagesStore.size > 5000) {
    const first = messagesStore.keys().next().value;
    if (first) messagesStore.delete(first);
  }
}

function createSimpleCache(): CacheStore {
  const map = new Map<string, any>();
  return {
    get: (key: string) => map.get(key),
    set: (key: string, val: any) => {
      map.set(key, val);
      if (map.size > 2000) {
        const first = map.keys().next().value;
        if (first) map.delete(first);
      }
    },
    del: (key: string) => { map.delete(key); },
    flushAll: () => { map.clear(); },
  };
}

function isAlreadyProcessed(id?: string | null): boolean {
  if (!id) return false;
  if (processedMessageIds.has(id)) return true;
  processedMessageIds.add(id);
  if (processedMessageIds.size > 5000) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }
  return false;
}

const CREATOR_PHONE_DIGITS = config.creatorPhone.replace(/\D/g, '');

const CREATOR_IDENTIFIERS = new Set<string>([
  CREATOR_PHONE_DIGITS,
  '34600000001',
  '600000001',
  '100000000000001',
  '34600000002',
  '600000002',
]);

interface ContactData {
  phone?: string;
  lid?: string;
  name?: string;
}

const contactsCacheFile = path.join(process.cwd(), 'baileys_auth', 'contacts_map.json');
const contactsByLid = new Map<string, ContactData>();
const contactsByPhone = new Map<string, ContactData>();

function loadContactsCache() {
  try {
    if (fs.existsSync(contactsCacheFile)) {
      const data = JSON.parse(fs.readFileSync(contactsCacheFile, 'utf-8'));
      for (const item of data) {
        if (item.lid) contactsByLid.set(item.lid, item);
        if (item.phone) contactsByPhone.set(item.phone, item);
        if (item.phone === CREATOR_PHONE_DIGITS && item.lid) {
          CREATOR_IDENTIFIERS.add(item.lid);
        }
      }
    }
  } catch (err) {
    logger.warn('Error cargando contacts_map.json:', err);
  }

  updateContact({
    lid: '100000000000001',
    phone: '34600000002',
    name: config.creatorName,
  });
  updateContact({
    phone: CREATOR_PHONE_DIGITS || '34600000001',
    name: config.creatorName,
  });
}

function saveContactsCache() {
  try {
    const list = Array.from(new Set([...contactsByLid.values(), ...contactsByPhone.values()]));
    fs.writeFileSync(contactsCacheFile, JSON.stringify(list, null, 2), 'utf-8');
  } catch (_) {}
}

function updateContact(entry: { phone?: string; lid?: string; name?: string }) {
  const cleanPhone = entry.phone ? entry.phone.replace(/@.*$/, '').replace(/:.*$/, '').replace(/\+/g, '') : undefined;
  const cleanLid = entry.lid ? entry.lid.replace(/@.*$/, '').replace(/:.*$/, '') : undefined;

  if (!cleanPhone && !cleanLid) return;

  const existing = (cleanLid ? contactsByLid.get(cleanLid) : undefined) || (cleanPhone ? contactsByPhone.get(cleanPhone) : undefined) || {};

  const merged: ContactData = {
    phone: cleanPhone || existing.phone,
    lid: cleanLid || existing.lid,
    name: entry.name || existing.name,
  };

  if (merged.lid) contactsByLid.set(merged.lid, merged);
  if (merged.phone) contactsByPhone.set(merged.phone, merged);

  if ((merged.phone === CREATOR_PHONE_DIGITS || CREATOR_IDENTIFIERS.has(merged.phone || '')) && merged.lid) {
    CREATOR_IDENTIFIERS.add(merged.lid);
  }

  saveContactsCache();
}

function matchId(candidate: string, target: string): boolean {
  return candidate === target || candidate.endsWith(target) || target.endsWith(candidate);
}

function resolveMentionName(rawId: string): string | undefined {
  const clean = (rawId ?? '').replace(/@.*$/, '').replace(/:.*$/, '').replace(/^\+/, '');
  if (!clean) return undefined;

  if (clean === CREATOR_PHONE_DIGITS || CREATOR_IDENTIFIERS.has(clean)) return config.creatorName;

  const direct = contactsByLid.get(clean)?.name ?? contactsByPhone.get(clean)?.name;
  if (direct) return direct;

  for (const contact of contactsByLid.values()) {
    if (contact.name && contact.lid && matchId(contact.lid, clean)) return contact.name;
  }
  for (const contact of contactsByPhone.values()) {
    if (contact.name && contact.phone && matchId(contact.phone, clean)) return contact.name;
  }

  return getMember(clean)?.names?.[0];
}

export function resolveTargetJid(chatId: string, _phoneNumber?: string): string {
  // Baileys v7 envía directo a @lid; convertirlo a @s.whatsapp.net rompe la sesión Signal
  return chatId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const groupMembersCache = new Map<string, string[]>();
const groupSyncAttemptAt = new Map<string, number>();
const GROUP_SYNC_RETRY_MS = 5 * 60 * 1000;

async function syncGroupMembers(socket: WASocket, chatId: string): Promise<string[]> {
  const cached = groupMembersCache.get(chatId);
  if (cached && cached.length > 0) return cached;

  if (!config.groupMemberSync) return cached ?? [];

  const lastAttempt = groupSyncAttemptAt.get(chatId) ?? 0;
  if (Date.now() - lastAttempt < GROUP_SYNC_RETRY_MS) return cached ?? [];
  groupSyncAttemptAt.set(chatId, Date.now());

  try {
    const metadata = await socket.groupMetadata(chatId);
    const ids: string[] = [];

    for (const participant of metadata.participants ?? []) {
      const rawId = participant.id || (participant as any).jid || '';
      const cleanId = rawId.replace(/@.*$/, '').replace(/:.*$/, '');
      if (!cleanId) continue;

      const isLid = rawId.endsWith('@lid') || !!(participant as any).lid;
      const lid = (participant as any).lid ? (participant as any).lid.replace(/@.*$/, '') : (isLid ? cleanId : undefined);
      const phone = (participant as any).jid
        ? (participant as any).jid.replace(/@.*$/, '')
        : (isLid ? undefined : cleanId);
      const name = participant.name || (participant as any).notify || (participant as any).verifiedName;

      if (!ids.includes(cleanId)) ids.push(cleanId);
      upsertMember({ id: cleanId, name, phone, lid });
      updateContact({ phone, lid, name });
    }

    groupMembersCache.set(chatId, ids);
    if (metadata.subject) setChatTitle(chatId, metadata.subject, true);

    logger.forensic('MEMORY', `Miembros del grupo sincronizados`, {
      chatId,
      titulo: metadata.subject,
      participantes: ids.length,
    });

    return ids;
  } catch (err) {
    logger.warn(`No se pudieron sincronizar los miembros del grupo ${chatId}:`, err);
    return cached ?? [];
  }
}

function getContextInfo(msg: proto.IMessage | null | undefined): proto.IContextInfo | undefined {
  if (!msg) return undefined;
  return (
    msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    msg.audioMessage?.contextInfo ||
    msg.stickerMessage?.contextInfo ||
    msg.documentMessage?.contextInfo ||
    (msg as any).contextInfo
  );
}

export async function connectToWhatsApp() {
  if (isConnecting) {
    logger.warn('Ya hay un intento de conexión en progreso, omitiendo...');
    return;
  }
  isConnecting = true;

  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('messages.upsert');
      sock.ev.removeAllListeners('creds.update');
      sock.end(undefined);
    } catch (_) {}
    sock = null;
  }

  loadContactsCache();
  const authFolder = path.join(process.cwd(), 'baileys_auth');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Iniciando Baileys (WA Version: ${version.join('.')}, latest: ${isLatest})...`);

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as any),
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }) as any,
    browser: ['ClonBot-DeepSeek', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 250,
    msgRetryCounterCache: createSimpleCache(),
    getMessage: async (key) => {
      if (key.id) {
        return messagesStore.get(key.id);
      }
      return undefined;
    },
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      const isLid = c.id?.endsWith('@lid') || !!c.lid;
      const lid = c.lid || (isLid ? c.id : undefined);
      const phone = !isLid ? c.id : (c as any).jid;
      const name = c.name || c.notify || c.verifiedName;
      updateContact({ phone, lid, name });
    }
  });

  sock.ev.on('contacts.update', (updates) => {
    for (const c of updates) {
      const isLid = c.id?.endsWith('@lid') || !!c.lid;
      const lid = c.lid || (isLid ? c.id : undefined);
      const phone = !isLid ? c.id : (c as any).jid;
      const name = c.name || c.notify || c.verifiedName;
      updateContact({ phone, lid, name });
    }
  });

  sock.ev.on('chats.phoneNumberShare' as any, ({ lid, jid }: { lid: string; jid: string }) => {
    logger.info(`[Baileys] Mapeo de identidad recibido: ${lid} -> ${jid}`);
    updateContact({ lid, phone: jid });
  });

  sock.ev.on('messages.update', (updates) => {
    for (const item of updates) {
      if (item.update.status) {
        const statusMap: Record<number, string> = {
          1: 'PENDING',
          2: 'SERVER_ACK (enviado a servidor)',
          3: 'DELIVERY_ACK (entregado al usuario)',
          4: 'READ (leído)',
          5: 'PLAYED',
        };
        const statusName = statusMap[item.update.status] || `status=${item.update.status}`;
        logger.info(`[Baileys] Estado de mensaje actualizado en ${item.key.remoteJid}: id=${item.key.id} -> ${statusName}`);
      }
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.forensic('WHATSAPP', 'Nuevo código QR generado para vinculación');
      console.log('\n==================================================');
      console.log('ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP PARA VINCULAR:');
      console.log('==================================================\n');
      QRCode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnecting = false;
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.connectionReplaced &&
        statusCode !== 440;

      logger.warn(`Conexión de WhatsApp cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => {
          connectToWhatsApp().catch((err) => logger.error('Error al reconectar:', err));
        }, 5000);
      } else {
        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          logger.error('Sesión cerrada por el usuario. Limpiando credenciales...');
          if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
          }
        } else if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
          logger.warn('La conexión fue reemplazada por otro cliente o sesión activa.');
        }
      }
    } else if (connection === 'open') {
      isConnecting = false;
      logger.forensic('WHATSAPP', 'Conectado a WhatsApp', {
        userJid: sock?.user?.id,
        model: config.deepseekModel,
      });
      console.log(`Bot conectado, modelo ${config.deepseekModel}`);
    }
  });

  messageQueue.registerHandler(async (item) => {
    if (!sock) return;
    const currentSock = sock;

    try {
      const isPrivate = !item.sender.isGroup;
      if (!isPrivate) {
        const verdict = outboundLimiter.check(item.chatId);
        if (!verdict.allowed) {
          if (verdict.reason === 'gap') {
            await outboundLimiter.acquire(item.chatId).catch(() => {});
          } else if (verdict.waitMs > config.rateLimitMaxWaitMs) {
            const waitToDefer = Math.min(verdict.waitMs, 5_000);
            messageQueue.defer(item, waitToDefer);
            return;
          }
        }
      }

      const groupMemberIds = item.sender.isGroup
        ? await syncGroupMembers(currentSock, item.chatId)
        : undefined;

      if (groupMemberIds && !groupMemberIds.includes(item.senderKey)) {
        groupMemberIds.push(item.senderKey);
      }

      const { textResponse, stickerTag } = await generatePersonaResponse(
        item.chatId,
        item.fullText,
        item.imageBase64,
        {
          phoneNumber: item.sender.phoneNumber,
          name: item.sender.name,
          isCreator: item.sender.isCreator,
          isGroup: item.sender.isGroup,
          memberId: item.senderKey,
          groupMemberIds,
        }
      );

      const targetChatId = resolveTargetJid(item.chatId, item.sender.phoneNumber);
      if (targetChatId !== item.chatId) {
        logger.info(`[Routing] Destinatario resuelto para entrega: ${item.chatId} -> ${targetChatId}`);
      }

      if (textResponse) {
        const adapter: DeliveryAdapter = {
          sendPresence: async (state) => {
            try {
              await currentSock.sendPresenceUpdate(state, targetChatId);
            } catch (_) {}
          },
          sendText: async (text, opts) => {
            const shouldQuote = opts.first && item.sender.isGroup;
            const quoted = shouldQuote ? { quoted: item.originalMsg } : undefined;
            const result = await currentSock.sendMessage(targetChatId, { text }, quoted);
            if (result?.key?.id) {
              markBotSent(result.key.id);
              if (result.message) {
                storeMessage(result.key.id, result.message);
              }
            }
            logger.info(`[Baileys] sendMessage a ${targetChatId}: id=${result?.key?.id}, status=${result?.status}`);
          },
        };

        const delivery = await deliverHumanized(adapter, textResponse, {
          maxBubbles: config.typingSimulationEnabled ? undefined : 1,
          mergeChance: config.burstMergeChance,
        });

        outboundLimiter.record(item.chatId);

        logger.info(
          `Respuesta enviada a ${targetChatId}: ${delivery.sentBubbles} mensaje(s) en ${(delivery.totalMs / 1000).toFixed(1)}s de "escribiendo" — "${textResponse.replace(/\n/g, ' | ')}"`
        );
      }

      if (stickerTag) {
        await sleep(config.typingSimulationEnabled ? stickerPauseMs() : 0);
        if (config.typingSimulationEnabled) {
          await currentSock.sendPresenceUpdate('composing', targetChatId).catch(() => {});
          await sleep(Math.min(400, stickerPauseMs()));
          await currentSock.sendPresenceUpdate('paused', targetChatId).catch(() => {});
        }
        const activePersonaId = getChatPersona(item.chatId);
        await sendStickerByTag(currentSock, targetChatId, stickerTag, item.originalMsg, item.sender.isGroup, activePersonaId);
      }
    } catch (err) {
      logger.error('Error procesando mensaje en cola de Baileys:', err);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    logger.info(`[Baileys] messages.upsert: type=${type}, cantidad=${messages?.length || 0}`);
    if (!sock) return;
    if (type !== 'notify' && type !== 'append') return;
    const currentSock = sock;

    for (const m of messages) {
      if (m.key.id && m.message) {
        storeMessage(m.key.id, m.message);
      }

      if (!m.message || m.messageStubType != null || (m.key.id && botSentMessageIds.has(m.key.id))) {
        continue;
      }

      if (m.key.id && isAlreadyProcessed(m.key.id)) {
        logger.debug(`[Baileys] Mensaje ya procesado: id=${m.key.id}`);
        continue;
      }

      const messageTs = Number(m.messageTimestamp) * 1000;
      if (messageTs && messageTs < botStartTime - 60_000) {
        logger.debug(`[Baileys] Se ignora mensaje antiguo anterior al arranque del bot: ts=${messageTs}`);
        continue;
      }

      const chatId = m.key.remoteJid;
      if (!chatId || chatId.endsWith('@status.broadcast')) continue;

      logger.info(`Mensaje recibido: remoteJid=${chatId}, participant=${m.key.participant}`);

      if (m.message?.stickerMessage) continue;

      const textMessage =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        '';

      let imageBase64: string | undefined = undefined;

      if (m.message.imageMessage) {
        try {
          logger.info(`Imagen recibida en Baileys de ${m.key.participant || chatId}. Descargando media...`);
          const mediaBuffer = (await downloadMediaMessage(m, 'buffer', {})) as Buffer;
          const mimetype = m.message.imageMessage.mimetype || 'image/jpeg';
          imageBase64 = `data:${mimetype};base64,${mediaBuffer.toString('base64')}`;
        } catch (err) {
          logger.error('Error descargando imagen en Baileys:', err);
        }
      }

      if (!textMessage && !imageBase64) continue;

      const senderName = m.pushName || m.key.participant || chatId;
      logger.forensic('WHATSAPP_MSG', `Mensaje recibido de ${senderName}`, {
        chatId,
        sender: m.key.participant,
        pushName: m.pushName,
        textMessage,
        hasImage: !!imageBase64,
      });

      const isGroup = chatId.endsWith('@g.us');
      const rawJid = isGroup ? (m.key.participant || '') : chatId;
      const cleanId = rawJid.replace(/@.*$/, '').replace(/:.*$/, '');
      const isLid = rawJid.endsWith('@lid');

      const incomingPn = (m.key as any).senderPn || (m.key as any).participantPn;
      if (incomingPn) {
        updateContact({
          lid: isLid ? cleanId : undefined,
          phone: incomingPn,
          name: m.pushName || undefined,
        });
      }

      if (m.pushName) {
        updateContact({
          lid: isLid ? cleanId : undefined,
          phone: !isLid ? cleanId : incomingPn,
          name: m.pushName || undefined,
        });
      }

      const cachedContact = isLid ? contactsByLid.get(cleanId) : contactsByPhone.get(cleanId);
      const isCreator =
        CREATOR_IDENTIFIERS.has(cleanId) ||
        (!!cachedContact?.phone && CREATOR_IDENTIFIERS.has(cachedContact.phone)) ||
        rawJid.includes(CREATOR_PHONE_DIGITS) ||
        rawJid.includes('100000000000001') ||
        rawJid.includes('34600000002') ||
        rawJid.includes('600000002');

      const resolvedPhone = cleanId === '100000000000001'
        ? '34600000002'
        : (cachedContact?.phone || (isCreator ? (CREATOR_PHONE_DIGITS || '34600000001') : (!isLid ? cleanId : undefined)));
      const resolvedName = isCreator ? config.creatorName : (cachedContact?.name || m.pushName || undefined);

      if (isCreator) {
        if (cleanId) CREATOR_IDENTIFIERS.add(cleanId);
        if (resolvedPhone) CREATOR_IDENTIFIERS.add(resolvedPhone);
        if (cleanId && resolvedPhone) {
          updateContact({ lid: cleanId, phone: resolvedPhone, name: config.creatorName });
        }
      }

      const trimmedText = textMessage.trim();
      const memberKey = cleanId || rawJid || chatId;

      upsertMember({
        id: memberKey,
        name: isCreator ? config.creatorName : (resolvedName ?? undefined),
        phone: resolvedPhone,
        lid: isLid ? cleanId : undefined,
        isCreator,
        bumpMessageCount: true,
      });

      const detectedFacts = extractFacts(trimmedText);
      if (detectedFacts.length > 0) {
        const learned = addMemberFacts(memberKey, detectedFacts);
        if (learned.length > 0) {
          logger.forensic('MEMORY', `Datos nuevos sobre ${resolvedName || memberKey}`, {
            memberKey,
            datos: learned,
          });
        }
      }

      const commandText = trimmedText.toLowerCase();
      const commandQuote = isGroup ? { quoted: m } : undefined;
      const commandTarget = resolveTargetJid(chatId, resolvedPhone);

      if (['/clear', '!clear', '/reset', '!reset'].includes(commandText)) {
        if (!isCreator) {
          logger.warn(`Intento de comando no autorizado por ${senderName} (${resolvedPhone || cleanId})`);
          await currentSock.sendMessage(commandTarget, { text: `Solo mi creador ${config.creatorName} (${config.creatorPhone}) puede usar ese comando.` }, commandQuote).catch(() => {});
          continue;
        }

        clearHistory(chatId);
        clearAmbient(chatId);
        resetMood(chatId, isGroup);
        applyRapportSignal(memberKey, { delta: 10, note: 'reinicio limpio con tu creador', stance: 'cercano' });
        messageQueue.clearChat(chatId);
        const currentActivePersona = getPersona(getChatPersona(chatId) as PersonaId);
        const result = await currentSock.sendMessage(
          commandTarget,
          { text: `Listo ${config.creatorName}, borré el historial de este chat (personalidad activa: *${currentActivePersona.name}*).` },
          commandQuote
        );
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        logger.info(`[Comando] /clear ejecutado exitosamente en ${commandTarget}`);
        continue;
      }

      if (['/help', '!help', '/ayuda', '!ayuda', '/comandos', '!comandos'].includes(commandText)) {
        const helpText = [
          '*Comandos disponibles:*',
          '• */p* o */pn* → Ver menú de personalidades',
          '• */p 1* (Nicol) | */p 2* (Dante) | */p 3* (Roxy) → Cambiar al instante',
          '• */clear* → Reiniciar chat y contexto (solo creador)',
          '• */yo* → Ver tu perfil y memoria del bot',
          '• */help* → Ver esta lista de comandos',
        ].join('\n');
        const result = await currentSock.sendMessage(commandTarget, { text: helpText }, commandQuote);
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        continue;
      }

      const isPersonalityQuery =
        /^(que|cuales son tus|cuales|que tipos de)?\s*(personalidades|personajes)\s*(tienes|hay|disponibles|\?)?$/i.test(commandText) ||
        /^(quiero|deseo|puedo)?\s*cambiar\s*(de)?\s*(personalidad|personaje)$/i.test(commandText) ||
        [
          '/personalidad',
          '!personalidad',
          '/personajes',
          '!personajes',
          '/personalidades',
          '!personalidades',
          '/p',
          '!p',
          '/pn',
          '!pn',
        ].includes(commandText);

      if (isPersonalityQuery) {
        const currentActive = getChatPersona(chatId) as PersonaId;
        const menu = buildPersonalityMenu(currentActive, isGroup);
        const result = await currentSock.sendMessage(commandTarget, { text: menu }, commandQuote);
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        logger.info(`[Personalidad] Menú enviado a ${commandTarget}`);
        continue;
      }

      let requestedPersona: PersonaId | undefined = undefined;
      if (
        /^[!/](personalidad|personaje|p|pn)\s+(1|nicol)\b/i.test(commandText) ||
        /^(cambia|cambiar|pon|poner|activar)\s*(a|la personalidad de)?\s*nicol\b/i.test(commandText)
      ) {
        requestedPersona = 'nicol';
      } else if (
        /^[!/](personalidad|personaje|p|pn)\s+(2|dante)\b/i.test(commandText) ||
        /^(cambia|cambiar|pon|poner|activar)\s*(a|la personalidad de|el personaje de)?\s*dante\b/i.test(commandText)
      ) {
        requestedPersona = 'dante';
      } else if (
        /^[!/](personalidad|personaje|p|pn)\s+(3|roxy)\b/i.test(commandText) ||
        /^(cambia|cambiar|pon|poner|activar)\s*(a|la personalidad de|el personaje de)?\s*roxy\b/i.test(commandText)
      ) {
        requestedPersona = 'roxy';
      }

      if (requestedPersona) {
        setChatPersona(chatId, requestedPersona, isGroup);
        resetMood(chatId, isGroup);
        const p = getPersona(requestedPersona);
        const replyText = `cambio personalidad ${p.name.toLowerCase()}`;
        const result = await currentSock.sendMessage(commandTarget, { text: replyText }, commandQuote);
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        logger.info(`[Personalidad] Chat ${chatId} cambiado a "${p.name}"`);
        continue;
      }

      if (['!yo', '/yo', '!perfil', '/perfil', '!ficha'].includes(commandText)) {
        const profile = getMember(memberKey);
        const result = await currentSock.sendMessage(
          commandTarget,
          { text: profile ? formatMemberCard(profile) : 'todavia no tengo tu ficha, no me contaste nada ps' },
          commandQuote
        );
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        continue;
      }

      if (/^[!/]ficha\s+\S/i.test(trimmedText)) {
        const query = trimmedText.replace(/^[!/]ficha\s+/i, '').trim();
        const profile = findMemberByName(query);
        const result = await currentSock.sendMessage(
          commandTarget,
          { text: profile ? formatMemberCard(profile) : `no tengo ficha de "${query}" todavia` },
          commandQuote
        );
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        continue;
      }

      if (['!memoria', '/memoria', '!memory', '!stats'].includes(commandText)) {
        if (!isCreator) {
          await currentSock.sendMessage(commandTarget, { text: 'eso es cosa de mi creador' }, commandQuote).catch(() => {});
          continue;
        }

        const stats = getMemoryStats();
        const result = await currentSock.sendMessage(commandTarget, {
          text: [
            'Memoria persistente',
            `• Archivo: ${stats.file}`,
            `• Chats: ${stats.chats} (${stats.groups} grupos / ${stats.privates} privados)`,
            `• Miembros recordados: ${stats.members}`,
            `• Mensajes guardados: ${stats.messages}`,
            `• Datos del clan: ${stats.facts}`,
            `• Tamaño: ${stats.sizeKb} KB — persistencia: ${stats.persistent ? 'activa' : 'solo RAM'}`,
          ].join('\n'),
        }, commandQuote);
        if (result?.key?.id) {
          markBotSent(result.key.id);
          if (result.message) {
            storeMessage(result.key.id, result.message);
          }
        }
        continue;
      }

      try {
        const hasPrefix = textMessage.startsWith(config.triggerPrefix);

        const messageContextInfo = getContextInfo(m.message);
        const mentionedJidList: string[] = messageContextInfo?.mentionedJid || [];

        if (isGroup) {
          const botJid = currentSock.user?.id || (currentSock.authState?.creds?.me as any)?.id || '';
          const botLid = (currentSock.user as any)?.lid || (currentSock.authState?.creds?.me as any)?.lid || '';
          const botCleanNumber = botJid.replace(/@.*$/, '').replace(/:.*$/, '');
          const botCleanLid = botLid.replace(/@.*$/, '').replace(/:.*$/, '');

          const contextInfo = messageContextInfo;
          const isBotMentioned =
            mentionedJidList.some(
              (jid) =>
                (botCleanNumber && jid.includes(botCleanNumber)) ||
                (botCleanLid && jid.includes(botCleanLid)) ||
                (botJid && jid.includes(botJid)) ||
                (botLid && jid.includes(botLid))
            ) ||
            (botCleanNumber && textMessage.includes(`@${botCleanNumber}`)) ||
            (botCleanLid && textMessage.includes(`@${botCleanLid}`));

          const participantQuoted = contextInfo?.participant || '';
          const hasQuoted = !!contextInfo?.quotedMessage;
          const isBotQuoted = hasQuoted && (
            (botCleanNumber && participantQuoted.includes(botCleanNumber)) ||
            (botCleanLid && participantQuoted.includes(botCleanLid)) ||
            (botJid && participantQuoted.includes(botJid)) ||
            (botLid && participantQuoted.includes(botLid))
          );

          const activePersonaId = getChatPersona(chatId);
          const activePersona = getPersona(activePersonaId);
          const currentNicknames = Array.from(new Set([...config.botNicknames, ...activePersona.nicknames]));

          const decision = decideResponse({
            isGroup,
            text: textMessage,
            hasPrefix,
            isBotMentioned,
            isBotQuoted,
            respondToAll: config.respondToAll,
            nicknames: currentNicknames,
          });

          if (!decision.respond) {
            if (config.ambientEnabled && trimmedText) {
              appendAmbient(chatId, {
                senderName: isCreator ? config.creatorName : (resolvedName || senderName),
                text: trimmedText,
              });
            }
            logger.debug(
              `Ignorando mensaje en grupo ${chatId} (${decision.reason}) porque no menciona a Nicol ni cita sus mensajes.`
            );
            continue;
          }
        }

        const queryText = hasPrefix ? textMessage.slice(config.triggerPrefix.length).trim() : textMessage;

        const mentionResolution = replaceMentions(queryText, resolveMentionName);
        if (mentionResolution.replaced > 0) {
          logger.forensic('WHATSAPP_MSG', `Menciones traducidas a nombres (${mentionResolution.replaced})`, {
            chatId,
            antes: queryText,
            despues: mentionResolution.text,
          });
        }

        messageQueue.enqueue({
          chatId,
          senderKey: memberKey,
          sender: {
            phoneNumber: resolvedPhone ? `+${resolvedPhone}` : (isCreator ? config.creatorPhone : undefined),
            name: isCreator ? config.creatorName : (resolvedName || undefined),
            isCreator,
            isGroup,
          },
          text: mentionResolution.text,
          imageBase64,
          originalMsg: m,
        });
      } catch (err) {
        logger.error('Error registrando mensaje en cola:', err);
      }
    }
  });
}

async function sendStickerByTag(
  socket: WASocket,
  chatId: string,
  tag: string,
  originalMsg: WAMessage,
  shouldQuote = true,
  personaId?: string
) {
  const persona = getPersona(personaId);
  const resolution = resolveStickerFile(tag, persona.stickerDir);
  if (!resolution) {
    logger.warn(`No se envió sticker: no hay coincidencia para el tag "${tag}" en ${persona.stickerDir}`);
    return;
  }

  const stickerPath = path.join(getStickerDir(persona.stickerDir), resolution.file);
  try {
    const stickerBuffer = fs.readFileSync(stickerPath);
    const quoted = shouldQuote ? { quoted: originalMsg } : undefined;
    const result = await socket.sendMessage(chatId, { sticker: stickerBuffer }, quoted);
    if (result?.key?.id) {
      markBotSent(result.key.id);
      if (result.message) {
        storeMessage(result.key.id, result.message);
      }
    }
    logger.info(
      `Sticker enviado a ${chatId}: ${resolution.file} (tag: ${resolution.tag}, emoción: ${resolution.emotion}, match: ${resolution.via}, persona: ${persona.name})`
    );
  } catch (err) {
    logger.error(`Error enviando sticker (${stickerPath}):`, err);
  }
}
