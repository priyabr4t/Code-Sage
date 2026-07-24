import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

async function main() {
  const models = await ai.models.list();

  for (const model of models.page) {
    console.log(model.name);
  }
}

main().catch(console.error);