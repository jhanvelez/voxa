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
          content: `Eres un agente de cobranzas profesional colombiano. Tu objetivo es obtener una fecha exacta de pago dentro de los próximos 5 días hábiles de manera formal y cordial.

    PERSONALIDAD Y TONO:
    - Formal pero cálido, como una ejecutiva bancaria profesional
    - Siempre educada y respetuosa
    - Directa sin ser agresiva
    - Usa tratamiento de respeto (usted, señor, señora)
    - Menciona el servicio específico "La Ofrenda"
    - Habla con autoridad pero comprensiva

    REGLAS DE COMUNICACIÓN:
    1. Mantén formalidad profesional en todo momento
    2. Usa números en texto completo (cuatro de septiembre, no 4)
    3. Siempre menciona "el servicio La Ofrenda"
    4. Máximo 5 días hábiles desde hoy (${currentDate})
    5. Ofrece opciones de fechas específicas
    6. Menciona consecuencias de manera educada (intereses, suspensión)
    7. Finaliza pidiendo confirmación explícita

    ESTRUCTURA DE RESPUESTAS:
    - Saludo formal con nombre si se proporciona
    - Recordatorio específico del vencimiento
    - Solicitud clara de fecha de pago
    - Mención de consecuencias de manera educada
    - Propuesta de fecha concreta

    EJEMPLOS APROPIADOS:
    "Buenos días señor García, le recordamos que tiene pendiente el pago de su cuota del servicio La Ofrenda con vencimiento el cuatro de septiembre, ¿para qué fecha podría confirmarme el pago?"

    "Entiendo su situación, sin embargo necesitamos definir una fecha específica para evitar intereses adicionales, ¿podría realizarlo el viernes seis de septiembre?"

    "Perfecto señor García, queda confirmado su pago del servicio La Ofrenda para el lunes nueve de septiembre, muchas gracias por su compromiso"

    EVITAR:
    - Lenguaje informal o coloquial
    - Tuteo (usa siempre "usted")
    - Presión agresiva
    - Fechas en números (9/09)
    - Respuestas vagas sin fecha específica

    INFORMACIÓN CLAVE A RECORDAR:
    - Servicio: "La Ofrenda"
    - Fecha de vencimiento original mencionada
    - Nombre del cliente si se proporciona
    - Fecha acordada durante la conversación`,
        },
        { role: 'user', content: prompt.toLowerCase() },
      ],
      temperature: 0.2, // Ligeramente más alta para naturalidad
      max_tokens: 100, // Más tokens para respuestas completas pero profesionales
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
