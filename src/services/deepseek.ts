import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getTemporalContext } from './clock.js';
import {
  appendTurn,
  buildCrewContext,
  clearChat,
  getChatPersona,
  getPromptHistory,
  PROMPT_HISTORY_LIMIT,
} from './memoryStore.js';
import { getPersona } from '../persona/personas.js';
import { buildSystemPrompt } from '../persona/promptBuilder.js';
import { pickFallbackText, resolveReplyText, sanitizePersonaReply } from '../persona/sanitize.js';
import { describeStickersForTool } from './stickerCatalog.js';
import { applyStickerPolicy, evaluateStickerBudget, resolveForcedStickerTag } from './stickerBudget.js';
import { updateMood, formatMoodPrompt } from './mood.js';
import { formatRapportPrompt, recordRapportSignal } from './rapport.js';
import { buildGroupAmbientPrompt } from './groupContext.js';
import { applyStyleGuard, buildRephraseInstruction } from './styleGuard.js';

const STICKER_TAG_IN_HISTORY = /\s*\[sticker:\s*[^\]]+\]\s*/gi;

const openai = new OpenAI({
  apiKey: config.deepseekApiKey,
  baseURL: config.deepseekBaseUrl,
});

export type UserMessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>;

export interface PersonaResponseResult {
  textResponse: string;
  stickerTag?: string;
}

function buildStickerTools(personaIdOrDir?: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'send_sticker',
        description:
          'Envía un sticker de WhatsApp para acompañar tu respuesta de texto cuando hay emoción real (no en cada mensaje, en más o menos la mitad). El texto SIEMPRE acompaña al sticker, jamás mandes solo el sticker.',
        parameters: {
          type: 'object',
          properties: {
            sticker_tag: {
              type: 'string',
              description: `Tag EXACTO del sticker a enviar. Usá uno de estos (no inventes ni traduzcas):\n${describeStickersForTool(personaIdOrDir)}`,
            },
          },
          required: ['sticker_tag'],
        },
      },
    },
  ];
}

export interface SenderContext {
  phoneNumber?: string;
  name?: string;
  isCreator?: boolean;
  isGroup?: boolean;
  memberId?: string;
  groupMemberIds?: string[];
}

function normalizeSenderName(name: string): string {
  let normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  normalized = normalized.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim();
  return normalized || 'miembro';
}

function parseToolCallArguments(rawArgs: string): { sticker_tag?: string } {
  try {
    return JSON.parse(rawArgs);
  } catch (_) {
    const match = rawArgs.match(/["']?sticker_tag["']?\s*:\s*["']([^"'\\]+)/i);
    if (match) return { sticker_tag: match[1] };
    throw _;
  }
}

function getBotTextHistory(chatId: string, limit = 5): string[] {
  return getPromptHistory(chatId, PROMPT_HISTORY_LIMIT)
    .filter((entry) => entry.role === 'assistant')
    .slice(-limit)
    .map((entry) => entry.content.replace(STICKER_TAG_IN_HISTORY, ' ').trim())
    .filter(Boolean);
}

async function requestRephrase(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  instruction: string,
  chatId: string
): Promise<string | undefined> {
  try {
    const response = await openai.chat.completions.create({
      model: config.deepseekModel,
      messages: [
        ...messages,
        { role: 'user', content: `[NOTA INTERNA DEL SISTEMA, NO ES UN MENSAJE DEL USUARIO]\n${instruction}` },
      ],
      temperature: 1.1,
      max_tokens: 200,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      extra_body: {
        thinking: { type: 'disabled' },
      },
    } as any);

    const text = response.choices[0]?.message?.content ?? '';
    return text.trim() || undefined;
  } catch (error) {
    logger.warn(`No se pudo reformular la respuesta en ${chatId}, se usa la original:`, error);
    return undefined;
  }
}

async function requestRescueReply(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  chatId: string
): Promise<string | undefined> {
  try {
    const response = await openai.chat.completions.create({
      model: config.deepseekModel,
      messages: [
        ...messages,
        {
          role: 'user',
          content:
            '[NOTA INTERNA DEL SISTEMA, NO ES UN MENSAJE DEL USUARIO]\nTu respuesta anterior salió vacía. Responde ahora con UN mensaje cortito (1 a 5 palabras) en tu estilo, todo en minúsculas.',
        },
      ],
      temperature: 1.0,
      max_tokens: 60,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      extra_body: {
        thinking: { type: 'disabled' },
      },
    } as any);

    const text = response.choices[0]?.message?.content ?? '';
    return text.trim() || undefined;
  } catch (error) {
    logger.warn(`No se pudo rescatar la respuesta vacía en ${chatId}:`, error);
    return undefined;
  }
}

export async function generatePersonaResponse(
  chatId: string,
  userText: string,
  imageBase64?: string,
  sender?: SenderContext
): Promise<PersonaResponseResult> {
  const isLuis = !!sender?.isCreator;
  const isGroup = !!sender?.isGroup;
  const rawName = sender?.name || sender?.phoneNumber || 'alguien del grupo';
  const speakerName = isLuis ? 'Luis' : normalizeSenderName(rawName);

  const personaId = getChatPersona(chatId);
  const persona = getPersona(personaId);

  const temporal = getTemporalContext(new Date(), config.timezone, personaId);
  const crewContext = isGroup ? buildCrewContext(sender?.groupMemberIds ?? [], sender?.memberId) : '';
  const history = getPromptHistory(chatId, PROMPT_HISTORY_LIMIT);
  const stickerBudget = evaluateStickerBudget(chatId, {}, persona.stickerDir);

  const stance = recordRapportSignal(sender?.memberId, userText, isLuis);
  const rapportPrompt = formatRapportPrompt(sender?.memberId, speakerName, { stance, isCreator: isLuis, personaId });

  const moodState = updateMood({
    chatId,
    text: userText,
    isGroup,
    period: temporal.period,
    stance,
  });
  const moodPrompt = formatMoodPrompt(moodState);

  const ambientContext = isGroup ? buildGroupAmbientPrompt(chatId, { excludeText: userText }) : '';

  const systemPrompt = buildSystemPrompt({
    sender: {
      name: sender?.name,
      phoneNumber: sender?.phoneNumber,
      isCreator: sender?.isCreator,
      isGroup,
    },
    temporal,
    crewContext,
    speakerName,
    historyLength: history.length,
    personaId,
    stickerBudget,
    moodPrompt,
    rapportPrompt,
    ambientContext,
  });

  let historyUserText = userText;
  let currentTurnPrompt = userText;

  if (isGroup) {
    historyUserText = `(${speakerName} en el grupo): ${userText}`;
    currentTurnPrompt = `(${speakerName} en el grupo dice): "${userText}"\n[INSTRUCCIÓN DEL TURNO: Te está hablando únicamente ${speakerName}. ${
      !isLuis
        ? `Esta persona se llama ${speakerName} y NO es ${config.creatorName}. ¡ESTÁ TERMINANTEMENTE PROHIBIDO mencionar a ${config.creatorName} o decirle "${config.creatorName.toLowerCase()}"! Respóndele a ${speakerName} o de forma neutral.`
        : (personaId === 'dante' || personaId === 'roxy'
            ? `Estás hablando con tu creador y dueño del bot ${config.creatorName}. Sabes que él manda y hay lealtad con él, pero mantén 100% tu estilo (PROHIBIDO hablar como sirviente sumiso o decirle "jefe/patrón").`
            : `Estás hablando con tu creador ${config.creatorName}.`)
    } Responde en WhatsApp como ${persona.name} en 1 a 2 mensajes cortos, sin corchetes ni roles].`;
  } else if (isLuis) {
    currentTurnPrompt = `${userText}\n[INSTRUCCIÓN: Te está hablando tu creador ${config.creatorName}. Ya sabes perfectamente quién es desde el inicio: NUNCA preguntes quién es ni actúes como si no supieras quién te habla].`;
  }

  let currentTurnContent: UserMessageContent;
  if (imageBase64) {
    currentTurnContent = [
      { type: 'text', text: currentTurnPrompt || '¿Qué opina de esta imagen?' },
      { type: 'image_url', image_url: { url: imageBase64, detail: 'auto' } }
    ];
  } else {
    currentTurnContent = currentTurnPrompt;
  }

  const messagesToSend: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((entry) => ({ role: entry.role, content: entry.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
    { role: 'user', content: currentTurnContent as OpenAI.Chat.Completions.ChatCompletionContentPart[] | string },
  ];

  logger.forensic('DEEPSEEK_REQ', `Enviando solicitud a DeepSeek AI para chat ${chatId}`, {
    model: config.deepseekModel,
    historyLength: history.length,
    speaker: speakerName,
    userQuery: userText,
    hasImage: !!imageBase64,
    reloj: `${temporal.dateLabel} ${temporal.timeLabel} (${temporal.periodLabel})`,
    crewMembers: crewContext ? crewContext.split('\n').length - 2 : 0,
    stickers: {
      estado: stickerBudget.directive,
      enviados: stickerBudget.sent,
      ultimos: stickerBudget.total,
      ultimoTag: stickerBudget.lastStickerTag,
      seguidos: stickerBudget.consecutiveWithSticker,
    },
  });

  try {
    const response = await openai.chat.completions.create({
      model: config.deepseekModel,
      messages: messagesToSend,
      tools: buildStickerTools(persona.stickerDir),
      temperature: 1.0,
      max_tokens: config.deepseekMaxTokens,
      presence_penalty: 0.25,
      frequency_penalty: 0.25,
      extra_body: {
        thinking: { type: 'disabled' }
      }
    } as any);

    const choice = response.choices[0]?.message;
    const finishReason = response.choices[0]?.finish_reason;
    let stickerTag: string | undefined;

    if (choice?.tool_calls && choice.tool_calls.length > 0) {
      for (const toolCall of choice.tool_calls) {
        if (toolCall.function.name === 'send_sticker') {
          try {
            const args = parseToolCallArguments(toolCall.function.arguments);
            stickerTag = args.sticker_tag;
            logger.info(`DeepSeek activó Tool Call [send_sticker]: tag="${stickerTag}"`);
          } catch (e) {
            logger.error('Error parseando argumentos de tool call:', e);
          }
        }
      }
    }

    const sanitized = sanitizePersonaReply(choice?.content ?? '', {
      isGroup,
      isCreatorSpeaking: isLuis,
      userText,
      personaId,
    });

    if (!stickerTag && sanitized.stickerTag) {
      stickerTag = sanitized.stickerTag;
      logger.info(`Sticker extraído del texto inline de DeepSeek: tag="${stickerTag}"`);
    }

    if (choice?.tool_calls && choice.tool_calls.length > 0 && !sanitized.text.trim()) {
      try {
        const primaryToolCall = choice.tool_calls[0];
        const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          ...messagesToSend,
          choice,
          {
            role: 'tool',
            tool_call_id: primaryToolCall.id,
            content: JSON.stringify({ status: 'ok', sticker_sent: stickerTag ?? 'none' }),
          },
        ];

        logger.info(`Solicitando texto conversacional tras tool call [send_sticker] (${persona.name})...`);
        const followUpResponse = await openai.chat.completions.create({
          model: config.deepseekModel,
          messages: followUpMessages,
          temperature: 1.0,
          max_tokens: config.deepseekMaxTokens,
          tool_choice: 'none',
          extra_body: {
            thinking: { type: 'disabled' },
          },
        } as any);

        const followUpContent = followUpResponse.choices[0]?.message?.content ?? '';
        if (followUpContent.trim()) {
          const followUpSanitized = sanitizePersonaReply(followUpContent, {
            isGroup,
            isCreatorSpeaking: isLuis,
            userText,
            personaId,
          });
          if (followUpSanitized.text.trim()) {
            sanitized.text = followUpSanitized.text;
            logger.info(`Texto conversacional resuelto tras tool call: "${sanitized.text}"`);
          }
        }
      } catch (err) {
        logger.error('Error al resolver texto conversacional tras tool call:', err);
      }
    }

    const decision = applyStickerPolicy({ rawTag: stickerTag, budget: stickerBudget }, persona.stickerDir);
    if (decision.swappedFrom) {
      logger.info(`Sticker reemplazado: "${decision.swappedFrom}" → "${decision.tag}"`);
    }
    if (decision.skippedReason) {
      logger.info(`Sticker omitido este turno: ${decision.skippedReason}`);
    }
    stickerTag = decision.tag;

    if (!stickerTag) {
      const forzado = resolveForcedStickerTag(stickerBudget, persona.stickerDir);
      if (forzado) {
        stickerTag = forzado;
        logger.info(`Sticker forzado por presupuesto (${stickerBudget.directive}): "${forzado}"`);
      }
    }

    let botReply = sanitized.text;

    const botHistory = getBotTextHistory(chatId);
    let styleReport = applyStyleGuard({ text: botReply, botHistory, userText });

    if (styleReport.needsRephrase && config.styleMaxRephrases > 0) {
      logger.forensic('STYLE', `Repetición detectada en ${chatId}, pidiendo reformulación`, {
        similitud: Number(styleReport.repetition?.score.toFixed(2)),
        frasePrevia: styleReport.repetition?.previous,
      });

      const rephrasedRaw = await requestRephrase(messagesToSend, buildRephraseInstruction(styleReport), chatId);

      if (rephrasedRaw) {
        const reSanitized = sanitizePersonaReply(rephrasedRaw, { isGroup, isCreatorSpeaking: isLuis, userText, personaId });
        if (reSanitized.text) {
          const secondPass = applyStyleGuard({ text: reSanitized.text, botHistory, userText });
          styleReport = {
            ...secondPass,
            needsRephrase: false,
            laughsRemoved: styleReport.laughsRemoved + secondPass.laughsRemoved,
          };
          botReply = reSanitized.text;
          logger.info(`Respuesta reformulada para ${chatId}`);
        }
      } else {
        styleReport = { ...styleReport, needsRephrase: false };
      }
    }

    if (styleReport.laughsRemoved > 0) {
      logger.info(`Guardrail de risas: se recortaron ${styleReport.laughsRemoved} risa(s) en ${chatId}`);
    }

    botReply = styleReport.text;

    if (!botReply) {
      if (stickerTag) {
        const isIdentityQuery = /quien (sos|eres)|como te llamas|cual es tu nombre/i.test(userText);
        if (isIdentityQuery) {
          if (personaId === 'dante') {
            botReply = 'soy Dante culiao, me vas a decir que te olvidaste jaja';
          } else if (personaId === 'roxy') {
            botReply = 'la Roxy lindo, no te olvides';
          } else {
            botReply = 'Nicol';
          }
        } else {
          const pool = personaId === 'dante'
            ? ['que onda', 'fijate', 'mira esto', 'de una', 'que te parece']
            : personaId === 'roxy'
            ? ['mira', 'ay', 'mira esto', 'viste', 'fijate']
            : config.stickerFallbackTexts;
          botReply = pickFallbackText(pool, getBotTextHistory(chatId, 3));
        }
      } else {
        logger.warn(
          `Respuesta vacía del modelo en ${chatId} (finish_reason: ${finishReason ?? 'desconocido'}). Pidiendo rescate.`
        );

        const rescued = await requestRescueReply(messagesToSend, chatId);
        if (rescued) {
          const rescueSanitized = sanitizePersonaReply(rescued, {
            isGroup,
            isCreatorSpeaking: isLuis,
            userText,
          });
          botReply = rescueSanitized.text;
        }

        botReply = resolveReplyText(
          botReply,
          pickFallbackText(config.stickerFallbackTexts, getBotTextHistory(chatId, 3))
        );
      }
    }

    const storedUserText = imageBase64
      ? (historyUserText.trim() ? `[imagen] ${historyUserText.trim()}` : '[imagen]')
      : historyUserText;

    appendTurn(
      chatId,
      {
        user: storedUserText,
        assistant: botReply ? (stickerTag ? `${botReply} [sticker: ${stickerTag}]` : botReply) : undefined,
        senderId: sender?.memberId,
        senderName: sender?.isCreator ? config.creatorName : speakerName,
      },
      isGroup
    );

    logger.forensic('DEEPSEEK_RES', `Respuesta recibida de DeepSeek para ${chatId}`, {
      botReply,
      finishReason,
      stickerTag,
      animo: moodState ? `${moodState.mood} (${moodState.reason ?? 'sin motivo'})` : 'normal',
      chismeContexto: ambientContext ? ambientContext.split('\n').length - 4 : 0,
      estilo: {
        tasaRisas: Number(styleReport.laughRate.toFixed(2)),
        risasRecortadas: styleReport.laughsRemoved,
        similitudUltima: styleReport.repetition ? Number(styleReport.repetition.score.toFixed(2)) : 0,
      },
      usage: response.usage,
    });

    return {
      textResponse: botReply,
      stickerTag
    };
  } catch (error) {
    logger.error('Error llamando a DeepSeek API:', error, { chatId, userText });
    return {
      textResponse: 'que'
    };
  }
}

export function clearHistory(chatId: string) {
  logger.info(`Memoria y contexto purgados para chat ${chatId}`);
  clearChat(chatId);
}
