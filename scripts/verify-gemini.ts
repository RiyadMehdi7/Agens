import { GoogleGenAI } from '@google/genai';
import { getConfig } from '../server/config.js';

const config = getConfig();
if (!config.configured) {
  console.error('Set GEMINI_API_KEY in the private .env.local file or Matrix secret environment. Do not paste it into chat.');
  process.exitCode = 1;
} else {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  try {
    for (const model of [config.liveModel, config.plannerModel]) {
      const result = await client.models.get({ model });
      console.log(JSON.stringify({ requested: model, available: Boolean(result.name) }));
    }
    console.log('Model metadata verified. This does not verify live audio or dashboard generation.');
  } catch {
    console.error('Model verification failed. Check account model access, credentials, quota and network.');
    process.exitCode = 1;
  }
}
