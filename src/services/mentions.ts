export function shortName(name?: string): string | undefined {
  const clean = (name ?? '').trim();
  if (!clean) return undefined;
  if (/^\+?[\d\s-]+$/.test(clean)) return undefined;

  const first = clean.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, '');
  return first.length >= 2 ? first.toLowerCase() : undefined;
}

export interface MentionResolution {
  text: string;
  replaced: number;
}

const MENTION_REGEX = /@(\d{5,})/g;

export function replaceMentions(
  text: string,
  lookup: (id: string) => string | undefined
): MentionResolution {
  const original = text ?? '';
  let replaced = 0;

  const result = original.replace(MENTION_REGEX, (whole: string, id: string) => {
    let name: string | undefined;
    try {
      name = shortName(lookup(id));
    } catch (_) {
      name = undefined;
    }

    if (!name) return whole;
    replaced += 1;
    return name;
  });

  return { text: result, replaced };
}
