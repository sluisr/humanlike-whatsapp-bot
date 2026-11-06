import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface StickerItem {
  file: string;
  tag: string;
  description: string;
  emotion: string;
  tags: string[];
}

export interface StickerMoment {
  id: string;
  when: string;
  mandatory: boolean;
  tags: string[];
}

export interface StickerPolicy {
  targetRate: number;
  emotionLabels: Record<string, string>;
  moments: StickerMoment[];
}

export type ResolutionVia = 'exacto' | 'etiqueta' | 'aproximado';

export interface StickerResolution {
  file: string;
  tag: string;
  emotion: string;
  via: ResolutionVia;
}

const DEFAULT_DIR = path.join(process.cwd(), 'assets', 'stickers');
const DUO_DIR = path.join(process.cwd(), 'assets', 'stickers_duo');
const MIN_FUZZY_LENGTH = 3;

interface CatalogData {
  indexed: StickerItem[];
  policy: StickerPolicy;
  dir: string;
}

const catalogMap = new Map<string, CatalogData>();

let currentDir = DEFAULT_DIR;
let indexed: StickerItem[] = [];
let policy: StickerPolicy = { targetRate: 0.6, emotionLabels: {}, moments: [] };
let loaded = false;

export function resolveDir(target?: string): string {
  if (!target) return currentDir;
  if (target === 'nicol') return DEFAULT_DIR;
  if (target === 'dante' || target === 'roxy') return DUO_DIR;
  if (path.isAbsolute(target)) return target;
  return path.resolve(process.cwd(), target);
}

export function normalizeTag(value: string): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toTag(file: string): string {
  return file.replace(/\.[a-z0-9]+$/i, '');
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn(`No existe ${filePath}, se usa el valor por defecto.`);
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err) {
    logger.error(`Error leyendo ${filePath}:`, err);
    return fallback;
  }
}

interface RawCatalogItem {
  file?: string;
  description?: string;
  emotion?: string;
  tags?: string[];
}

export function loadStickerData(options: { dir?: string; force?: boolean } = {}): CatalogData {
  const dir = resolveDir(options.dir);

  if (!options.force && catalogMap.has(dir)) {
    const cached = catalogMap.get(dir)!;
    if (dir === currentDir) {
      indexed = cached.indexed;
      policy = cached.policy;
    }
    return cached;
  }

  const rawCatalog = readJsonFile<RawCatalogItem[]>(path.join(dir, 'stickers_catalog.json'), []);
  const missingFiles: string[] = [];
  const items: StickerItem[] = [];

  for (const raw of rawCatalog) {
    if (!raw?.file) continue;

    const exists = fs.existsSync(path.join(dir, raw.file));
    if (!exists) missingFiles.push(raw.file);

    const tag = toTag(raw.file);
    const tags = Array.from(new Set([tag, ...(raw.tags ?? [])].map(normalizeTag).filter(Boolean)));

    items.push({
      file: raw.file,
      tag,
      description: raw.description ?? tag,
      emotion: raw.emotion ?? 'otros',
      tags,
    });
  }

  if (items.length === 0) {
    logger.warn(`Catálogo de stickers vacío en ${dir}`);
  }
  if (missingFiles.length > 0) {
    logger.warn(`Stickers del catálogo sin archivo en disco: ${missingFiles.join(', ')}`);
  }

  const rawPolicy = readJsonFile<Partial<StickerPolicy>>(path.join(dir, 'sticker_policy.json'), {});
  const knownTags = new Set(items.map((item) => item.tag));
  const moments = (rawPolicy.moments ?? []).filter((moment) => moment && Array.isArray(moment.tags));

  for (const moment of moments) {
    const invalid = moment.tags.filter((tag) => !knownTags.has(tag));
    if (invalid.length > 0) {
      logger.warn(`Momento "${moment.id}" apunta a stickers inexistentes: ${invalid.join(', ')}`);
    }
  }

  const sortedItems = items.sort((a, b) => a.file.localeCompare(b.file));
  const loadedPolicy: StickerPolicy = {
    targetRate: typeof rawPolicy.targetRate === 'number' ? rawPolicy.targetRate : 0.6,
    emotionLabels: rawPolicy.emotionLabels ?? {},
    moments,
  };

  const catalogEntry: CatalogData = {
    indexed: sortedItems,
    policy: loadedPolicy,
    dir,
  };

  catalogMap.set(dir, catalogEntry);

  if (dir === currentDir || !loaded) {
    currentDir = dir;
    indexed = sortedItems;
    policy = loadedPolicy;
    loaded = true;
  }

  logger.forensic('STICKERS', `Catálogo cargado desde ${dir}`, {
    stickers: sortedItems.length,
    emociones: new Set(sortedItems.map((item) => item.emotion)).size,
    momentosObligatorios: moments.filter((moment) => moment.mandatory).length,
    momentosOpcionales: moments.filter((moment) => !moment.mandatory).length,
  });

  return catalogEntry;
}

export function getStickers(target?: string): StickerItem[] {
  const dir = resolveDir(target);
  return loadStickerData({ dir }).indexed;
}

export function getStickerPolicy(target?: string): StickerPolicy {
  const dir = resolveDir(target);
  return loadStickerData({ dir }).policy;
}

export function getStickerDir(target?: string): string {
  return resolveDir(target);
}

export function listCanonicalTags(target?: string): string[] {
  return getStickers(target).map((item) => item.tag);
}

export function getStickerByTag(tag: string, target?: string): StickerItem | undefined {
  const needle = normalizeTag(tag);
  return getStickers(target).find((item) => item.tag === needle);
}

function scoreCandidate(item: StickerItem, needle: string): number {
  if (item.tag === needle) return 1000;
  if (item.tags.includes(needle)) return 900;

  if (needle.length >= MIN_FUZZY_LENGTH) {
    if (item.tag.includes(needle) || needle.includes(item.tag)) return 500 + item.tag.length;

    for (const tag of item.tags) {
      if (tag.includes(needle) || needle.includes(tag)) return 300 + tag.length;
    }
  }

  return 0;
}

export function resolveStickerFile(tag: string, target?: string): StickerResolution | undefined {
  const needle = normalizeTag(tag);
  if (!needle) return undefined;

  let best: StickerItem | undefined;
  let bestScore = 0;

  for (const item of getStickers(target)) {
    const score = scoreCandidate(item, needle);
    if (score > bestScore || (score === bestScore && best && item.file.localeCompare(best.file) < 0)) {
      best = item;
      bestScore = score;
    }
  }

  if (!best || bestScore === 0) return undefined;

  const via: ResolutionVia = bestScore >= 1000 ? 'exacto' : bestScore >= 900 ? 'etiqueta' : 'aproximado';
  return { file: best.file, tag: best.tag, emotion: best.emotion, via };
}

export function findAlternativeSticker(tag: string, emotion?: string, target?: string): StickerResolution | undefined {
  const current = normalizeTag(tag);
  const targetEmotion = emotion ?? getStickerByTag(current, target)?.emotion;
  if (!targetEmotion) return undefined;

  const pool = getStickers(target).filter((item) => item.tag !== current && item.emotion === targetEmotion);
  if (pool.length === 0) return undefined;

  const pick = pool[0];
  return { file: pick.file, tag: pick.tag, emotion: pick.emotion, via: 'etiqueta' };
}

export function isMandatoryTag(tag: string, target?: string): boolean {
  const needle = normalizeTag(tag);
  return getStickerPolicy(target).moments.some(
    (moment) => moment.mandatory && moment.tags.some((t) => normalizeTag(t) === needle)
  );
}

export function getMandatoryMomentFor(tag: string, target?: string): StickerMoment | undefined {
  const needle = normalizeTag(tag);
  return getStickerPolicy(target).moments.find(
    (moment) => moment.mandatory && moment.tags.some((t) => normalizeTag(t) === needle)
  );
}

export function describeStickersForTool(target?: string): string {
  return getStickers(target)
    .map((item) => `${item.tag}: ${item.description}`)
    .join('\n');
}

export function describeStickersForPrompt(target?: string): string {
  const stickers = getStickers(target);
  const labels = getStickerPolicy(target).emotionLabels;
  const groups = new Map<string, string[]>();

  for (const item of stickers) {
    const list = groups.get(item.emotion) ?? [];
    list.push(item.tag);
    groups.set(item.emotion, list);
  }

  return [...groups.entries()]
    .map(([emotion, tags]) => `- **${labels[emotion] ?? emotion}**: ${tags.join(', ')}`)
    .join('\n');
}

export function describeMomentsForPrompt(target?: string): string {
  const moments = getStickerPolicy(target).moments;
  const mandatory = moments.filter((moment) => moment.mandatory);
  const optional = moments.filter((moment) => !moment.mandatory);

  const lines: string[] = [];

  if (mandatory.length > 0) {
    lines.push('[MOMENTOS CON STICKER SÍ O SÍ — no es opcional, es tu forma de reaccionar]');
    for (const moment of mandatory) {
      lines.push(`- ${moment.when} → ${moment.tags.join(' o ')}`);
    }
  }

  if (optional.length > 0) {
    lines.push('[MOMENTOS DONDE PEGA UN STICKER (a tu criterio)]');
    for (const moment of optional) {
      lines.push(`- ${moment.when} → ${moment.tags.join(' o ')}`);
    }
  }

  return lines.join('\n');
}

export function resetStickerCache(): void {
  catalogMap.clear();
  indexed = [];
  policy = { targetRate: 0.6, emotionLabels: {}, moments: [] };
  currentDir = DEFAULT_DIR;
  loaded = false;
}
