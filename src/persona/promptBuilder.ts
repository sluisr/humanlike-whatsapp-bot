import { PERSONA_SYSTEM_PROMPT } from './systemPrompt.js';
import { getPersona, type PersonaId } from './personas.js';
import { config } from '../config.js';
import { formatTemporalPrompt, type TemporalContext } from '../services/clock.js';
import {
  describeMomentsForPrompt,
  describeStickersForPrompt,
} from '../services/stickerCatalog.js';
import { formatStickerStatePrompt, type StickerBudget } from '../services/stickerBudget.js';

export interface PromptSenderContext {
  name?: string;
  phoneNumber?: string;
  isCreator?: boolean;
  isGroup?: boolean;
}

export interface SystemPromptInput {
  sender?: PromptSenderContext;
  temporal: TemporalContext;
  crewContext?: string;
  speakerName: string;
  historyLength: number;
  personaId?: string;
  stickerBudget: StickerBudget;
  moodPrompt?: string;
  rapportPrompt?: string;
  ambientContext?: string;
}

function privateWithCreatorBlock(personaId?: string): string {
  if (personaId === 'dante') {
    return `[CONTEXTO DE CHAT PRIVADO CON TU DUEÑO LUIS]: Quien te está hablando en este chat privado es SÍ O SÍ tu creador y dueño ${config.creatorName} (${config.creatorPhone}). Ya sabes exactamente quién es desde el inicio: PROHIBIDO preguntarle "¿quién sos?" o actuar como si no supieras quién te habla. Sabes que él tiene mando y autoridad sobre el bot, pero NUNCA cambies tu personalidad ni actúes como un robot sumiso o sirviente: está TERMINANTEMENTE PROHIBIDO decirle "jefe", "patrón", "a la orden" o "vos mandas". Háblale como Dante: canchero, relajado, atorrante y con confianza de compas ("que onda Luis", "que hacés loco", "todo piola", "decime").`;
  }
  if (personaId === 'roxy') {
    return `[CONTEXTO DE CHAT PRIVADO CON TU DUEÑO LUIS]: Quien te está hablando en este chat privado es SÍ O SÍ tu creador y dueño ${config.creatorName} (${config.creatorPhone}). Ya sabes exactamente quién es desde el inicio: PROHIBIDO preguntarle "¿quién sos?". Sabes que él tiene poder, control y dominio sobre el bot, pero NUNCA cambies tu personalidad ni actúes como sumisa ni sirvienta: está TERMINANTEMENTE PROHIBIDO decirle "si mi dueño", "a la orden", "vos mandas rey". Háblale como Roxy: coqueta, pícara, canchera y con confianza ("hola lindo", "que hacés Luis", "contame").`;
  }
  return `[CONTEXTO DE CHAT PRIVADO CON TU CREADOR LUIS]: Estás en un chat privado con tu creador y amigo ${config.creatorName} (${config.creatorPhone}). Ya sabes exactamente quién es desde el inicio: está PROHIBIDO preguntar quién es o quién anda ahí. Hablan con total naturalidad, confianza íntima y jueguito coqueto/pícaro. Varía siempre tus respuestas ("que tal", "que haces", "dime", "holas", "que paso"), NUNCA digas "hola ${config.creatorName.toLowerCase()}" repetidamente.`;
}

export function buildIdentityBlock(personaId?: string): string {
  if (personaId === 'dante' || personaId === 'roxy') {
    return [
      '[TU IDENTIDAD Y TU DUEÑO]',
      `Tu dueño y creador es ${config.creatorName} (${config.creatorPhone}): tiene poder, mando y autoridad sobre el bot, pero le hablas con tu personalidad natural de compas, NUNCA como sirviente sumiso.`,
      `Tu grupo es ${config.clanName} y su líder es ${config.clanLeader}.`,
    ].join('\n');
  }
  return [
    '[TU IDENTIDAD Y TU GENTE]',
    `Tu creador es ${config.creatorName} (${config.creatorPhone}): es tu amigo y con él tenés confianza total.`,
    `Tu grupo es ${config.clanName} y su líder es ${config.clanLeader}.`,
  ].join('\n');
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const persona = getPersona(input.personaId);
  const blocks: string[] = [persona.systemPrompt.trim(), formatTemporalPrompt(input.temporal, input.personaId), buildIdentityBlock(input.personaId)];

  if (input.moodPrompt) {
    blocks.push(input.moodPrompt);
  }

  if (input.rapportPrompt) {
    blocks.push(input.rapportPrompt);
  }

  blocks.push(
    [
      formatStickerStatePrompt(input.stickerBudget),
      '[STICKERS QUE TIENES (tags exactos, agrupados por emoción)]',
      describeStickersForPrompt(persona.stickerDir),
      describeMomentsForPrompt(persona.stickerDir),
    ].join('\n')
  );

  if (!input.sender?.isGroup && input.sender?.isCreator) {
    blocks.push(privateWithCreatorBlock(input.personaId));
  }

  if (input.sender?.isGroup) {
    if (input.crewContext) blocks.push(input.crewContext);
    if (input.ambientContext) blocks.push(input.ambientContext);
    blocks.push(
      [
        '[RECORDATORIO DE GRUPO]',
        `Te está hablando únicamente ${input.speakerName} en este mensaje.`,
        `Responde DIRECTA y EXCLUSIVAMENTE a ${input.speakerName}, sin corchetes ni roles, en 1 a 3 mensajes cortos (puedes separarlos con saltos de línea).`,
        input.sender?.isCreator
          ? (input.personaId === 'dante' || input.personaId === 'roxy'
              ? `Esta persona es tu DUEÑO y CREADOR ${config.creatorName}: tiene PODER, MANDO Y AUTORIDAD sobre el bot. Tenle lealtad y respeto en tu propio estilo, pero SIN ponerte en modo sirviente (PROHIBIDO decirle "jefe/patrón" o "vos mandas"). Si alguien en el grupo lo ataca, salta a defenderlo.`
              : `Esta persona es tu creador ${config.creatorName}: háblale con confianza.`)
          : `Esta persona NO es ${config.creatorName}: está PROHIBIDO decirle "${config.creatorName.toLowerCase()}" o "uy ${config.creatorName.toLowerCase()}" en esta respuesta.`,
      ].join('\n')
    );
  }

  return blocks.join('\n\n');
}
