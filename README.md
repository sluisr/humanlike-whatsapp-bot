# natural-ai-whatsapp

A WhatsApp bot that tries to be as close to a real person as it can get. It talks through [Baileys](https://github.com/WhiskeySockets/Baileys) (no official API, it links as one more device) and thinks with DeepSeek.

This is an old personal project, not a polished product. It was built for a friends' group chat, it is not meant to be installed and used as is, and you will need to read the code to make sense of it. I'm publishing it as a reference for anyone interested in making a bot feel less like a bot.

The default persona, Nicol, is modeled on how a real person texts. The prompts, nicknames and group names are written for one specific chat. If you reuse any of it, replace them with your own.

## The idea

Most chatbots fail the "is this a person?" test for small reasons: they answer instantly, in perfect paragraphs, with the same shape every time. This project tackles those details one by one:

- **Timing.** The typing indicator lasts as long as a person would need for that text, with a short pause before starting. Replies can come as several short bubbles, and sometimes two are merged so the pattern doesn't repeat.
- **Style guard.** It measures its own recent messages. Too many laughs, a repeated phrase or the same edge in every reply gets trimmed or rephrased.
- **Stickers.** The model picks stickers by tag from a catalog. A budget keeps the usage rate close to a target, blocks long streaks and swaps a sticker that was just used.
- **Memory.** Per-chat history on disk, plus small facts about each person ("is 17", "plays Blood Strike") so it doesn't mix people up in groups.
- **Mood and rapport.** Each chat has a mood that fades after a few turns. Each person has a score that decides how warm or sharp the replies are.
- **Clock.** It knows the date and time in its timezone and adjusts: late night, school hours, lunch.
- **Rate limits.** Per-chat and global caps on outgoing messages, to avoid getting the number banned.
- **Personas.** Three characters (Nicol, Dante, Roxy), selectable per chat.

## Requirements

- Node.js 20+
- A DeepSeek API key
- A WhatsApp number to link. Use one you can afford to lose: Baileys is unofficial and WhatsApp can ban the account.

## Running it

```bash
npm install
cp .env.example .env
npm run dev
```

Put your key in `.env` (`DEEPSEEK_API_KEY`). On the first run a QR code shows up in the terminal; scan it from WhatsApp under *Linked devices*. The session is stored in `baileys_auth/`.

For production: `npm run build && npm start`.

## Configuration

Everything is an environment variable, all listed in `.env.example`. The ones you will touch first:

| Variable | Default | What it does |
|---|---|---|
| `DEEPSEEK_API_KEY` | | API key |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Model name |
| `DEEPSEEK_MAX_TOKENS` | `800` | Too low and the model burns its budget reasoning and returns an empty reply |
| `RESPOND_TO_ALL` | `false` | Reply to every group message, not only when mentioned |
| `BOT_NICKNAMES` | nicol, val, ... | Names that trigger a reply in a group |
| `CREATOR_NAME`, `CREATOR_PHONE` | | Who can run admin commands |
| `TIMEZONE` | `America/La_Paz` | Timezone of the internal clock |
| `TYPING_SIMULATION` | `true` | `false` replies instantly |
| `RATE_LIMIT_PER_MINUTE` | `60` | Max replies per chat per minute |

## Commands

| Command | Who | Effect |
|---|---|---|
| `!reset` | creator | Clears the chat history |
| `!yo`, `!perfil` | anyone | Shows what the bot remembers about you |
| `!ficha <name>` | anyone | Same, for someone else |
| `!memoria` | creator | Memory stats |
| `/p`, `/pn`, `/personalidad` | anyone | Lists or switches the persona (`/p 2`, `/p roxy`) |

## Tests

```bash
npm test
npm run typecheck
npm run smoke
```

`smoke` runs the whole pipeline against the real DeepSeek API without touching WhatsApp, so it costs tokens.

## Layout

```
src/
  config.ts         environment variables
  persona/          prompts, characters, reply cleanup
  services/         WhatsApp, DeepSeek, memory, stickers, timing, style guard, rate limits
  tools/            manual test scripts
  tests/            node:test suites
assets/             sticker catalogs and policy
```

The prompts and most log messages are in Spanish.

## A note on honesty

The default prompts tell the bot to deny being an AI. If you run this in a chat, tell the people in it. Don't use it to deceive anyone who hasn't agreed to talk to a bot.

## License

MIT, see [LICENSE](LICENSE). By [sluisr](https://sluisr.com).
