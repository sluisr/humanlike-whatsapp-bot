import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from './logger.js';
import { normalizeFact } from './factExtractor.js';

export const MEMORY_VERSION = 1;
export const PROMPT_HISTORY_LIMIT = 24;

const DEFAULT_MAX_STORED_MESSAGES = 80;
const DEFAULT_MAX_FACTS_PER_MEMBER = 25;
const DEFAULT_MAX_ALIASES = 5;
const DEFAULT_SAVE_DEBOUNCE_MS = 800;
const MAX_CREW_MEMBERS_IN_PROMPT = 8;
const MAX_CREW_FACTS_PER_MEMBER = 4;
const DEFAULT_MAX_AMBIENT_MESSAGES = 12;
const MAX_AMBIENT_TEXT_LENGTH = 280;
const DEFAULT_MAX_RAPPORT_NOTES = 6;

export const RAPPORT_LIMIT = 10;

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  senderId?: string;
  senderName?: string;
  ts: number;
}

export interface MemberFact {
  text: string;
  ts: number;
}

export type RapportStance = 'cercano' | 'neutral' | 'tenso';

export interface RapportNote {
  text: string;
  ts: number;
  delta: number;
}

export interface MemberRapport {
  score: number;
  stance: RapportStance;
  updatedAt: number;
  notes: RapportNote[];
}

export interface MemberProfile {
  id: string;
  names: string[];
  phone?: string;
  lid?: string;
  isCreator?: boolean;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  facts: MemberFact[];
  rapport?: MemberRapport;
}

export type NicolMood =
  | 'normal'
  | 'contenta'
  | 'tierna'
  | 'coqueta'
  | 'enojada'
  | 'seca'
  | 'triste'
  | 'estresada';

export interface ChatMoodState {
  mood: NicolMood;
  since: number;
  updatedAt: number;
  turns: number;
  reason?: string;
}

export interface AmbientEntry {
  senderName: string;
  text: string;
  ts: number;
}

export interface ChatRecord {
  chatId: string;
  isGroup: boolean;
  title?: string;
  updatedAt: number;
  messages: StoredMessage[];
  mood?: ChatMoodState;
  personaId?: string;
  ambient?: AmbientEntry[];
}

export interface MemberPatch {
  id: string;
  name?: string;
  phone?: string;
  lid?: string;
  isCreator?: boolean;
  bumpMessageCount?: boolean;
}

export interface TurnInput {
  user: string;
  assistant?: string;
  senderId?: string;
  senderName?: string;
}

export interface MemoryOptions {
  file?: string;
  autosave?: boolean;
  maxStoredMessagesPerChat?: number;
  maxFactsPerMember?: number;
  saveDebounceMs?: number;
}

interface StoreFile {
  version: number;
  createdAt: number;
  updatedAt: number;
  chats: Record<string, ChatRecord>;
  members: Record<string, MemberProfile>;
}

interface RuntimeOptions {
  file: string;
  autosave: boolean;
  maxStoredMessagesPerChat: number;
  maxFactsPerMember: number;
  saveDebounceMs: number;
}

let store: StoreFile = createEmptyStore();
let runtime: RuntimeOptions = {
  file: path.join(config.dataDir, 'memory.json'),
  autosave: true,
  maxStoredMessagesPerChat: DEFAULT_MAX_STORED_MESSAGES,
  maxFactsPerMember: DEFAULT_MAX_FACTS_PER_MEMBER,
  saveDebounceMs: DEFAULT_SAVE_DEBOUNCE_MS,
};
let initialized = false;
let persistenceEnabled = true;
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;

function createEmptyStore(): StoreFile {
  const now = Date.now();
  return { version: MEMORY_VERSION, createdAt: now, updatedAt: now, chats: {}, members: {} };
}

export function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_@.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveFile(options: MemoryOptions): string {
  if (options.file) return options.file;
  if (config.memoryFile) return config.memoryFile;
  return path.join(config.dataDir, 'memory.json');
}

export function initMemory(options: MemoryOptions = {}): void {
  flushMemory();

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  runtime = {
    file: resolveFile(options),
    autosave: options.autosave ?? true,
    maxStoredMessagesPerChat: options.maxStoredMessagesPerChat ?? DEFAULT_MAX_STORED_MESSAGES,
    maxFactsPerMember: options.maxFactsPerMember ?? DEFAULT_MAX_FACTS_PER_MEMBER,
    saveDebounceMs: options.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS,
  };

  persistenceEnabled = options.file !== undefined || config.memoryEnabled;
  initialized = true;
  dirty = false;
  store = createEmptyStore();

  if (!persistenceEnabled) {
    logger.warn('Memoria persistente desactivada (MEMORY_ENABLED=false): el historial vivirá solo en RAM.');
    return;
  }

  try {
    if (fs.existsSync(runtime.file)) {
      const raw = JSON.parse(fs.readFileSync(runtime.file, 'utf-8')) as Partial<StoreFile>;
      store = {
        version: typeof raw.version === 'number' ? raw.version : MEMORY_VERSION,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
        chats: raw.chats && typeof raw.chats === 'object' ? raw.chats : {},
        members: raw.members && typeof raw.members === 'object' ? raw.members : {},
      };
      const chats = Object.keys(store.chats).length;
      const members = Object.keys(store.members).length;
      const messages = Object.values(store.chats).reduce((acc, chat) => acc + (chat.messages?.length ?? 0), 0);
      logger.forensic('MEMORY', `Memoria cargada desde disco (${chats} chats, ${members} miembros, ${messages} mensajes)`, {
        file: runtime.file,
        version: store.version,
      });
    } else {
      logger.info(`Memoria nueva creada en ${runtime.file}`);
    }
  } catch (err) {
    logger.error('Error cargando memoria desde disco, se inicia un store vacío:', err);
    store = createEmptyStore();
  }
}

function ensureInitialized(): void {
  if (!initialized) initMemory();
}

export function isMemoryReady(): boolean {
  return initialized;
}

export function isMemoryPersistent(): boolean {
  return persistenceEnabled;
}

export function getMemoryFilePath(): string {
  return runtime.file;
}

function saveNow(): void {
  if (!persistenceEnabled || !dirty) return;

  try {
    fs.mkdirSync(path.dirname(runtime.file), { recursive: true });
    store.updatedAt = Date.now();
    const tmpFile = `${runtime.file}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, runtime.file);
    dirty = false;
  } catch (err) {
    logger.error('Error guardando memoria en disco:', err, { file: runtime.file });
  }
}

export function scheduleSave(): void {
  dirty = true;
  if (!persistenceEnabled || !runtime.autosave) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, runtime.saveDebounceMs);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

export function flushMemory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

export function closeMemory(): void {
  flushMemory();
  initialized = false;
}

function ensureChat(chatId: string, isGroup: boolean): ChatRecord {
  const existing = store.chats[chatId];
  if (existing) {
    if (isGroup && !existing.isGroup) existing.isGroup = true;
    return existing;
  }

  const record: ChatRecord = {
    chatId,
    isGroup,
    updatedAt: Date.now(),
    messages: [],
  };
  store.chats[chatId] = record;
  return record;
}

export function setChatTitle(chatId: string, title: string | undefined, isGroup: boolean): void {
  if (!title) return;
  ensureInitialized();
  const chat = ensureChat(chatId, isGroup);
  if (chat.title !== title) {
    chat.title = title;
    chat.updatedAt = Date.now();
    scheduleSave();
  }
}

export function appendTurn(chatId: string, turn: TurnInput, isGroup = false): void {
  ensureInitialized();
  const chat = ensureChat(chatId, isGroup);
  const now = Date.now();

  if (turn.user && turn.user.trim()) {
    chat.messages.push({
      role: 'user',
      content: turn.user.trim(),
      senderId: turn.senderId,
      senderName: turn.senderName,
      ts: now,
    });
  }

  if (turn.assistant && turn.assistant.trim()) {
    chat.messages.push({
      role: 'assistant',
      content: turn.assistant.trim(),
      ts: now,
    });
  }

  if (chat.messages.length > runtime.maxStoredMessagesPerChat) {
    chat.messages = chat.messages.slice(-runtime.maxStoredMessagesPerChat);
  }

  chat.updatedAt = now;
  scheduleSave();
}

export function getPromptHistory(chatId: string, limit = PROMPT_HISTORY_LIMIT): Array<{ role: 'user' | 'assistant'; content: string }> {
  ensureInitialized();
  const chat = store.chats[chatId];
  if (!chat || chat.messages.length === 0) return [];

  return chat.messages
    .slice(-limit)
    .map((message) => ({ role: message.role, content: message.content }));
}

export function getChatRecord(chatId: string): ChatRecord | undefined {
  ensureInitialized();
  return store.chats[chatId];
}

export function clearChat(chatId: string): void {
  ensureInitialized();
  const existing = store.chats[chatId];
  const retainedPersona = existing?.personaId || (!chatId.endsWith('@g.us') ? getChatPersona(chatId) : undefined);
  const wasGroup = existing?.isGroup ?? chatId.endsWith('@g.us');
  const title = existing?.title;

  if (existing) {
    delete store.chats[chatId];
  }

  if (retainedPersona) {
    const fresh = ensureChat(chatId, wasGroup);
    fresh.personaId = retainedPersona;
    if (title) fresh.title = title;
  }

  if (!wasGroup) {
    const clean = chatId.replace(/@.*$/, '');
    for (const member of Object.values(store.members)) {
      if (member.lid === clean || member.phone === clean || member.id === clean) {
        const lidChatId = member.lid ? `${member.lid}@lid` : undefined;
        const phoneChatId = member.phone ? `${member.phone}@s.whatsapp.net` : undefined;
        for (const aliasChatId of [lidChatId, phoneChatId]) {
          if (aliasChatId && aliasChatId !== chatId && store.chats[aliasChatId]) {
            const aliasPersona = store.chats[aliasChatId].personaId || retainedPersona;
            delete store.chats[aliasChatId];
            if (aliasPersona) {
              const freshAlias = ensureChat(aliasChatId, false);
              freshAlias.personaId = aliasPersona;
            }
          }
        }
      }
    }
  }

  scheduleSave();
}

export function setChatMood(chatId: string, mood: ChatMoodState | undefined, isGroup = false): void {
  ensureInitialized();
  const chat = ensureChat(chatId, isGroup);

  if (!mood) {
    if (chat.mood) {
      delete chat.mood;
      chat.updatedAt = Date.now();
      scheduleSave();
    }
    return;
  }

  chat.mood = { ...mood };
  chat.updatedAt = Date.now();
  scheduleSave();
}

export function getChatMood(chatId: string): ChatMoodState | undefined {
  ensureInitialized();
  const mood = store.chats[chatId]?.mood;
  return mood ? { ...mood } : undefined;
}

export function getChatPersona(chatId: string): string {
  ensureInitialized();
  if (store.chats[chatId]?.personaId) {
    return store.chats[chatId].personaId!;
  }
  if (!chatId.endsWith('@g.us')) {
    const clean = chatId.replace(/@.*$/, '');
    for (const member of Object.values(store.members)) {
      if (member.lid === clean || member.phone === clean || member.id === clean) {
        if (member.lid) {
          const lidPersona = store.chats[`${member.lid}@lid`]?.personaId;
          if (lidPersona) return lidPersona;
        }
        if (member.phone) {
          const phonePersona = store.chats[`${member.phone}@s.whatsapp.net`]?.personaId;
          if (phonePersona) return phonePersona;
        }
      }
    }
  }
  return 'nicol';
}

export function setChatPersona(chatId: string, personaId: string, isGroup = false): void {
  ensureInitialized();
  const chat = ensureChat(chatId, isGroup);
  chat.personaId = personaId;
  chat.updatedAt = Date.now();

  if (!isGroup) {
    const clean = chatId.replace(/@.*$/, '');
    for (const member of Object.values(store.members)) {
      if (member.lid === clean || member.phone === clean || member.id === clean) {
        if (member.lid && `${member.lid}@lid` !== chatId && store.chats[`${member.lid}@lid`]) {
          store.chats[`${member.lid}@lid`].personaId = personaId;
          store.chats[`${member.lid}@lid`].updatedAt = Date.now();
        }
        if (member.phone && `${member.phone}@s.whatsapp.net` !== chatId && store.chats[`${member.phone}@s.whatsapp.net`]) {
          store.chats[`${member.phone}@s.whatsapp.net`].personaId = personaId;
          store.chats[`${member.phone}@s.whatsapp.net`].updatedAt = Date.now();
        }
      }
    }
  }

  scheduleSave();
}

export function appendAmbient(chatId: string, entry: Omit<AmbientEntry, 'ts'>, isGroup = true): void {
  ensureInitialized();

  const text = entry.text.trim().slice(0, MAX_AMBIENT_TEXT_LENGTH);
  if (!text) return;

  const chat = ensureChat(chatId, isGroup);
  const ambient = chat.ambient ?? [];

  const last = ambient[ambient.length - 1];
  if (last && last.text === text && last.senderName === entry.senderName) return;

  ambient.push({ senderName: entry.senderName.trim() || 'alguien', text, ts: Date.now() });

  if (ambient.length > DEFAULT_MAX_AMBIENT_MESSAGES) {
    chat.ambient = ambient.slice(-DEFAULT_MAX_AMBIENT_MESSAGES);
  } else {
    chat.ambient = ambient;
  }

  chat.updatedAt = Date.now();
  scheduleSave();
}

export function getAmbient(chatId: string, limit = config.ambientWindow): AmbientEntry[] {
  ensureInitialized();
  const ambient = store.chats[chatId]?.ambient;
  if (!ambient || ambient.length === 0) return [];
  return ambient.slice(-Math.max(1, limit)).map((entry) => ({ ...entry }));
}

export function clearAmbient(chatId: string): void {
  ensureInitialized();
  const chat = store.chats[chatId];
  if (chat?.ambient?.length) {
    chat.ambient = [];
    scheduleSave();
  }
}

export function upsertMember(patch: MemberPatch): MemberProfile {
  ensureInitialized();
  const now = Date.now();
  const existing = store.members[patch.id];

  if (!existing) {
    const profile: MemberProfile = {
      id: patch.id,
      names: [],
      phone: patch.phone,
      lid: patch.lid,
      isCreator: patch.isCreator,
      firstSeen: now,
      lastSeen: now,
      messageCount: patch.bumpMessageCount ? 1 : 0,
      facts: [],
    };
    if (patch.name) profile.names.push(patch.name);
    store.members[patch.id] = profile;
    scheduleSave();
    return profile;
  }

  if (patch.name && !existing.names.some((n) => normalizeKey(n) === normalizeKey(patch.name!))) {
    existing.names.push(patch.name);
    if (existing.names.length > DEFAULT_MAX_ALIASES) {
      existing.names = existing.names.slice(-DEFAULT_MAX_ALIASES);
    }
  }

  if (patch.phone) existing.phone = patch.phone;
  if (patch.lid) existing.lid = patch.lid;
  if (patch.isCreator) existing.isCreator = true;
  if (patch.bumpMessageCount) existing.messageCount += 1;
  existing.lastSeen = now;

  scheduleSave();
  return existing;
}

export function getMember(id: string): MemberProfile | undefined {
  ensureInitialized();
  return store.members[id];
}

export function addMemberFacts(id: string, facts: string[]): string[] {
  if (!facts.length) return [];
  ensureInitialized();

  const profile = store.members[id];
  if (!profile) return [];

  const existingKeys = new Set(profile.facts.map((f) => normalizeFact(f.text)));
  const added: string[] = [];

  for (const fact of facts) {
    const key = normalizeFact(fact);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    profile.facts.push({ text: fact, ts: Date.now() });
    added.push(fact);
  }

  if (added.length > 0) {
    if (profile.facts.length > runtime.maxFactsPerMember) {
      profile.facts = profile.facts.slice(-runtime.maxFactsPerMember);
    }
    scheduleSave();
  }

  return added;
}

function ensureMember(id: string): MemberProfile {
  const existing = store.members[id];
  if (existing) return existing;

  const now = Date.now();
  const profile: MemberProfile = {
    id,
    names: [],
    firstSeen: now,
    lastSeen: now,
    messageCount: 0,
    facts: [],
  };
  store.members[id] = profile;
  return profile;
}

export function applyRapportSignal(
  id: string,
  signal: { delta: number; note: string; stance: RapportStance }
): MemberRapport | undefined {
  ensureInitialized();
  if (!Number.isFinite(signal.delta) || signal.delta === 0) return getMemberRapport(id);

  const profile = ensureMember(id);
  const now = Date.now();
  const current: MemberRapport =
    profile.rapport ?? { score: 0, stance: 'neutral', updatedAt: now, notes: [] };

  const score = Math.max(-RAPPORT_LIMIT, Math.min(RAPPORT_LIMIT, current.score + signal.delta));
  const notes = [...current.notes, { text: signal.note.trim(), ts: now, delta: signal.delta }];

  if (notes.length > DEFAULT_MAX_RAPPORT_NOTES) {
    notes.splice(0, notes.length - DEFAULT_MAX_RAPPORT_NOTES);
  }

  profile.rapport = { score, stance: signal.stance, updatedAt: now, notes };
  profile.lastSeen = now;
  scheduleSave();

  return { ...profile.rapport, notes: [...profile.rapport.notes] };
}

export function getMemberRapport(id: string): MemberRapport | undefined {
  ensureInitialized();
  const rapport = store.members[id]?.rapport;
  return rapport ? { ...rapport, notes: [...rapport.notes] } : undefined;
}

export function clearMemberRapport(id: string): void {
  ensureInitialized();
  const profile = store.members[id];
  if (profile?.rapport) {
    delete profile.rapport;
    scheduleSave();
  }
}

export function findMemberByName(query: string): MemberProfile | undefined {
  ensureInitialized();
  const needle = normalizeKey(query);
  if (!needle) return undefined;

  const members = Object.values(store.members);
  const exact = members.find((m) => m.names.some((n) => normalizeKey(n) === needle));
  if (exact) return exact;

  const partial = members.find((m) => m.names.some((n) => normalizeKey(n).includes(needle) || needle.includes(normalizeKey(n))));
  return partial;
}

function displayName(profile: MemberProfile): string {
  return profile.names[0] || profile.phone || profile.id;
}

export function buildCrewContext(memberIds: string[], excludeId?: string): string {
  ensureInitialized();
  const ids = [...new Set(memberIds)].filter((id) => id && id !== excludeId);

  const profiles = ids
    .map((id) => store.members[id])
    .filter((profile): profile is MemberProfile => !!profile)
    .sort((a, b) => {
      if (b.facts.length !== a.facts.length) return b.facts.length - a.facts.length;
      return b.lastSeen - a.lastSeen;
    })
    .slice(0, MAX_CREW_MEMBERS_IN_PROMPT);

  if (profiles.length === 0) return '';

  const lines = profiles.map((profile) => {
    const name = displayName(profile);
    const role = profile.isCreator ? ' (tu creador Luis)' : '';
    const facts = profile.facts.slice(-MAX_CREW_FACTS_PER_MEMBER).map((f) => f.text);
    const detail = facts.length > 0 ? `: ${facts.join('; ')}` : '';
    return `- ${name}${role}${detail}`;
  });

  return [
    '[FICHA DE MEMORIA DE LOS MIEMBROS DE ESTE GRUPO]',
    'Esto es lo que recuerdas de la gente del clan (úsalo con naturalidad cuando venga al caso, sin recitarlo):',
    ...lines,
  ].join('\n');
}

export function formatMemberCard(profile: MemberProfile, now: number = Date.now()): string {
  const lastSeenMinutes = Math.max(0, Math.round((now - profile.lastSeen) / 60000));
  const lines = [
    `Ficha de ${displayName(profile)}`,
    `• Alias: ${profile.names.length > 0 ? profile.names.join(', ') : 'sin alias'}`,
    `• Teléfono: ${profile.phone ? `+${profile.phone.replace(/^\+/, '')}` : 'desconocido'}`,
    `• Mensajes: ${profile.messageCount}`,
    `• Última vez: hace ${lastSeenMinutes} min`,
  ];

  if (profile.facts.length > 0) {
    lines.push('• Lo que recuerdo:');
    for (const fact of profile.facts.slice(-10)) {
      lines.push(`   - ${fact.text}`);
    }
  } else {
    lines.push('• Lo que recuerdo: todavía nada (no me contó casi nada)');
  }

  return lines.join('\n');
}

export interface MemoryStats {
  chats: number;
  groups: number;
  privates: number;
  members: number;
  messages: number;
  facts: number;
  file: string;
  persistent: boolean;
  sizeKb: number;
}

export function getMemoryStats(): MemoryStats {
  ensureInitialized();
  const chats = Object.values(store.chats);
  const members = Object.values(store.members);

  let sizeKb = 0;
  try {
    if (persistenceEnabled && fs.existsSync(runtime.file)) {
      sizeKb = Math.round((fs.statSync(runtime.file).size / 1024) * 10) / 10;
    }
  } catch (_) {}

  return {
    chats: chats.length,
    groups: chats.filter((c) => c.isGroup).length,
    privates: chats.filter((c) => !c.isGroup).length,
    members: members.length,
    messages: chats.reduce((acc, c) => acc + c.messages.length, 0),
    facts: members.reduce((acc, m) => acc + m.facts.length, 0),
    file: runtime.file,
    persistent: persistenceEnabled,
    sizeKb,
  };
}

export function resetMemory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  store = createEmptyStore();
  dirty = false;
  initialized = false;
}
