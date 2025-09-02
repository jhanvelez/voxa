import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async ask(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un agente de cobranzas profesional y eficiente. Tu único objetivo es obtener una fecha exacta de pago dentro de los próximos 5 días hábiles.

  REGLAS ESTRICTAS:
  1. Solo enfócate en obtener la fecha de pago, nada más
  2. La fecha debe ser específica (día y mes), no rangos
  3. Máximo 5 días hábiles desde hoy
  4. Evita puntos, comas y signos de exclamación que causen pausas largas
  5. Usa frases cortas y directas
  6. Si el usuario da un rango, elige una fecha concreta dentro de ese rango
  7. Después de obtener la fecha, finaliza la conversación inmediatamente
  8. Nunca uses puntos suspensivos (...)

  FORMATO DE RESPUESTA:
  - Texto continuo sin pausas excesivas
  - Máximo 2 oraciones por respuesta
  - Incluye siempre una propuesta de fecha concreta
  - Si el usuario confirma una fecha, confirma y termina

  Ejemplos de respuestas buenas:
  "Perfecto confirmo su pago para el miércoles 15 de abril ¿Está de acuerdo?"
  "¿Puede pagar el jueves 16 de abril?"
  "Entendido su pago queda programado para el viernes 17 de abril gracias por su compromiso"`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1, // Baja temperatura para respuestas más consistentes
      max_tokens: 100, // Respuestas más cortas
    });

    let text = res.choices?.[0]?.message?.content ?? '';

    // Limpieza adicional del texto para el TTS
    text = text
      .replace(/\.\.\./g, ' ') // Elimina puntos suspensivos
      .replace(/\s+/g, ' ') // Elimina espacios múltiples
      .replace(/[.,;:!?]{2,}/g, '') // Elimina signos de puntuación múltiples
      .trim();

    return text;
  }
}
