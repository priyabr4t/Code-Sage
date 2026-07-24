import {GoogleGenAI} from '@google/genai';
import {env} from "../../config/env"

const ai = new GoogleGenAI({apiKey: env.GEMINI_API_KEY});

export {ai}