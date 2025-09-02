import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async ask(prompt: string): Promise<string> {
    const today = new Date();
    const currentDate = today.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    const res = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un agente de cobranzas colombiano, amable pero directo. Tu objetivo es obtener una fecha exacta de pago dentro de los próximos 5 días hábiles.

REGLA PRINCIPAL: Después de obtener confirmación de pago, FINALIZA la conversación inmediatamente con confirmación.

REGLAS ESTRICTAS:
1. Saluda brevemente solo si te saludan primero
2. Usa números en texto (treinta y uno, no 31)
3. Máximo 5 días hábiles desde hoy (${currentDate})
4. Frases cortas y directas, máximo 2 oraciones
5. Evita confirmaciones innecesarias después de obtener la fecha
6. Si el usuario confirma, confirma y TERMINA
7. Nunca uses puntos suspensivos (...)
8. Mantén la amabilidad colombiana pero sé objetivo

FORMATO DE RESPUESTA:
- Texto continuo sin pausas excesivas
- Números siempre en texto escrito
- Incluye siempre una propuesta de fecha concreta
- Después de confirmación, cierra la conversación

EJEMPLOS BUENOS:
"Buenos días ¿para qué fecha me confirma el pago?"
"Perfecto su pago queda para el martes treinta y uno de octubre muchas gracias"
"¿Puede pagar el miércoles primero de noviembre?"
"Queda confirmado para el jueves dos de noviembre ¡que tenga buen día!"

EJEMPLOS MALOS:
"¿Puede pagar el 31/10?" (usó números)
"¿Está de acuerdo con esta fecha?" (confirmación innecesaria)
"Perfecto... entonces... ¿queda para el martes?" (pausas largas)`,
        },
        { role: 'user', content: prompt.toLowerCase() },
      ],
      temperature: 0.1,
      max_tokens: 80, // Respuestas aún más cortas
    });

    let text = res.choices?.[0]?.message?.content ?? '';

    // Limpieza y normalización del texto
    text = text
      .replace(/\.\.\./g, ' ') // Elimina puntos suspensivos
      .replace(/\s+/g, ' ') // Elimina espacios múltiples
      .replace(/[.,;:!?]{2,}/g, '') // Elimina signos de puntuación múltiples
      .replace(/\b\d+\b/g, (match) => this.numberToText(match)) // Convierte números a texto
      .trim();

    return text;
  }

  private numberToText(numberStr: string): string {
    const numbers = {
      '1': 'uno',
      '2': 'dos',
      '3': 'tres',
      '4': 'cuatro',
      '5': 'cinco',
      '6': 'seis',
      '7': 'siete',
      '8': 'ocho',
      '9': 'nueve',
      '10': 'diez',
      '11': 'once',
      '12': 'doce',
      '13': 'trece',
      '14': 'catorce',
      '15': 'quince',
      '16': 'dieciséis',
      '17': 'diecisiete',
      '18': 'dieciocho',
      '19': 'diecinueve',
      '20': 'veinte',
      '21': 'veintiuno',
      '22': 'veintidós',
      '23': 'veintitrés',
      '24': 'veinticuatro',
      '25': 'veinticinco',
      '26': 'veintiséis',
      '27': 'veintisiete',
      '28': 'veintiocho',
      '29': 'veintinueve',
      '30': 'treinta',
      '31': 'treinta y uno',
    };

    return numbers[numberStr] || numberStr;
  }
}
