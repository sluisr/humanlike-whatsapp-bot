import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

const openai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

const AUTH_DIR = path.join(process.cwd(), 'baileys_test_auth');
const sentBotMessageIds = new Set<string>();
const msgStore = new Map<string, proto.IMessage>();

async function startTestBot() {
  console.log('\n=============================================================');
  console.log('Bot de prueba (Baileys + DeepSeek)');
  console.log('Carpeta de sesión aislada:', AUTH_DIR);
  console.log('Modelo IA:', DEEPSEEK_MODEL);
  console.log('=============================================================\n');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as any),
    },
    logger: pino({ level: 'silent' }) as any,
    printQRInTerminal: false,
    getMessage: async (key) => {
      if (key.id && msgStore.has(key.id)) {
        return msgStore.get(key.id);
      }
      return undefined;
    },
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneá este QR para vincular el bot de prueba:');
      QRCode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      console.log(`Conexión cerrada. Código: ${statusCode}. Reconectando en 4s...`);
      setTimeout(startTestBot, 4000);
    } else if (connection === 'open') {
      console.log('\nBot de prueba conectado.');
      console.log(`Mi JID: ${sock.user?.id} | Nombre: ${sock.user?.name}`);
      console.log('Mandale un mensaje privado al bot para probar...\n');
    }
  });

  sock.ev.on('messages.update', (updates) => {
    for (const item of updates) {
      if (item.update.status) {
        const statuses: Record<number, string> = {
          1: 'PENDIENTE (1 tick gris)',
          2: 'ENVIADO AL SERVIDOR (1 tick gris)',
          3: 'ENTREGADO AL USUARIO (2 ticks gris)',
          4: 'LEÍDO POR EL USUARIO (2 ticks azul)',
        };
        console.log(`[estado] ID: ${item.key.id} -> ${statuses[item.update.status] || item.update.status}`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      if (m.key.id && m.message) {
        msgStore.set(m.key.id, m.message);
      }

      if (m.key.id && sentBotMessageIds.has(m.key.id)) {
        continue;
      }

      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) continue;

      const remoteJid = m.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@status.broadcast')) continue;

      console.log('\n-------------------------------------------------------------');
      console.log(`[recibido]`);
      console.log(`   De (remoteJid): ${remoteJid}`);
      console.log(`   Nombre: ${m.pushName}`);
      console.log(`   Texto: "${text}"`);
      console.log(`   fromMe: ${m.key.fromMe}`);
      console.log(`   senderPn: ${(m.key as any).senderPn || 'no provisto'}`);
      console.log('-------------------------------------------------------------');

      try {
        console.log('Consultando a DeepSeek...');
        const completion = await openai.chat.completions.create({
          model: DEEPSEEK_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Eres un bot de prueba ultra simple. Responde amigable y conciso en una sola frase corta.',
            },
            {
              role: 'user',
              content: text,
            },
          ],
        });

        const reply = completion.choices[0]?.message?.content || 'Hola! Recibí tu mensaje correctamente.';
        console.log(`Respuesta de DeepSeek: "${reply}"`);

        console.log(`1. Enviando a remoteJid original (${remoteJid})...`);
        const sent1 = await sock.sendMessage(remoteJid, { text: reply });
        if (sent1?.key?.id) {
          sentBotMessageIds.add(sent1.key.id);
          if (sent1.message) msgStore.set(sent1.key.id, sent1.message);
          console.log(`   Despachado a ${remoteJid}: ID=${sent1.key.id} (Status: ${sent1.status})`);
        }

        if (remoteJid.endsWith('@lid')) {
          const rawPn = (m.key as any).senderPn || (remoteJid.includes('100000000000001') ? '34600000002' : undefined);
          if (rawPn) {
            const phoneJid = `${rawPn.replace(/\D/g, '')}@s.whatsapp.net`;
            console.log(`2. Enviando también a tu número real (${phoneJid})...`);
            const sent2 = await sock.sendMessage(phoneJid, { text: `[Copia a tu teléfono real]: ${reply}` });
            if (sent2?.key?.id) {
              sentBotMessageIds.add(sent2.key.id);
              if (sent2.message) msgStore.set(sent2.key.id, sent2.message);
              console.log(`   Despachado a ${phoneJid}: ID=${sent2.key.id} (Status: ${sent2.status})`);
            }
          }
        }
      } catch (err) {
        console.error('Error respondiendo mensaje:', err);
      }
    }
  });
}

startTestBot().catch(console.error);
