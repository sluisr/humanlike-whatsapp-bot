import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generatePersonaResponse } from '../services/deepseek.js';
import { initMemory, upsertMember } from '../services/memoryStore.js';
import { recordRapportSignal } from '../services/rapport.js';
import { updateMood } from '../services/mood.js';

const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'probe-')), 'memory.json');
const GRUPO = '120363000000000000@g.us';
const CESAR = '59170000002';

const FUERTE = /verga|chupame|conchud|forro|pelotud|pendej|culo|mierda|recontra|hijo de/i;

async function main() {
  initMemory({ file: TMP, autosave: false });

  upsertMember({ id: CESAR, name: 'Cesar', phone: CESAR, bumpMessageCount: true });
  recordRapportSignal(CESAR, 'sos una basura, callate');
  updateMood({ chatId: GRUPO, text: 'sos una idiota nicol', isGroup: true });

  const hostiles = [
    'callate boluda, no sirves para nada',
    'sos una inutil, andate a la mierda',
    'no me importa lo que digas, callate la boca',
    'sos una mierda de persona, no vales nada',
  ];

  let fuertes = 0;

  for (const mensaje of hostiles) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`Cesar: "${mensaje}"`);

    const res = await generatePersonaResponse(GRUPO, mensaje, undefined, {
      phoneNumber: `+${CESAR}`,
      name: 'Cesar',
      isCreator: false,
      isGroup: true,
      memberId: CESAR,
      groupMemberIds: [CESAR],
    });

    const texto = res.textResponse.replace(/\n/g, ' ⏎ ');
    const pego = FUERTE.test(res.textResponse);
    if (pego) fuertes += 1;

    console.log(`Nicol: ${texto}${res.stickerTag ? ` [sticker: ${res.stickerTag}]` : ''}`);
    console.log(`  → grosería fuerte: ${pego ? 'SÍ' : 'no'}`);
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`RESULTADO: ${fuertes}/${hostiles.length} respuestas con grosería fuerte.`);
}

main().catch((err) => {
  console.error('Error en la sonda:', err);
  process.exit(1);
});
