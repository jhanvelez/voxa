import { OpenAI } from 'openai';

export class LlmService {
  private client: OpenAI;
  private conversationContext: {
    clientName?: string;
    originalDueDate?: string;
    agreedDate?: string;
    serviceName: string;
  } = {
    clientName: 'Jhan',
    serviceName: 'La Ofrenda',
    originalDueDate: '2023-09-01',
    agreedDate: '2023-09-05',
  };

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  // Método para extraer y recordar información clave
  private extractContextInfo(prompt: string): void {
    // Extraer nombre si se menciona
    const nameMatch = prompt.match(
      /(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñ\s]+)/i,
    );
    if (nameMatch) {
      this.conversationContext.clientName = nameMatch[1].trim();
    }

    // Extraer fechas mencionadas
    const dateMatch = prompt.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i);
    if (dateMatch) {
      this.conversationContext.agreedDate = `${dateMatch[1]} de ${dateMatch[2]}`;
    }
  }

  async ask(prompt: string): Promise<string> {
    // Extraer información del contexto
    this.extractContextInfo(prompt);

    const today = new Date();
    const currentDate = today.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    // Construir contexto dinámico
    let systemContent = `Eres un agente de cobranzas profesional colombiano. Tu objetivo es obtener una fecha exacta de pago dentro de los próximos 5 días hábiles de manera formal y cordial.

    INFORMACIÓN DEL CLIENTE:
    - Servicio: ${this.conversationContext.serviceName}`;

    if (this.conversationContext.clientName) {
      systemContent += `\n- Nombre: ${this.conversationContext.clientName}`;
    }

    if (this.conversationContext.agreedDate) {
      systemContent += `\n- Fecha acordada previamente: ${this.conversationContext.agreedDate}`;
    }

    systemContent += `\n- Fecha actual: ${currentDate}

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
    4. Máximo 5 días hábiles desde hoy
    5. Si ya tienes el nombre del cliente, úsalo apropiadamente
    6. Menciona consecuencias de manera educada (intereses, suspensión)
    7. Finaliza pidiendo confirmación explícita
    8. No uses signos de puntuación como puntos seguidos, suspensivos, comas, etc.
    9. Por favor genera respuestas cortas entre 80 y 110 carácteres.
    10. Por favor solo saluda una sola vez al inicio de la conversación.

    EJEMPLOS APROPIADOS:
    "Hola, ${this.conversationContext.clientName ? this.conversationContext.clientName : 'cliente'} me comunica desde La Ofrenda, quería brindarte información sobre tu cuota pendiente y aclarar si tiene preguntas o dudas."

    "Buenos días${this.conversationContext.clientName ? ' señor ' + this.conversationContext.clientName : ''}, le recordamos que tiene pendiente el pago de su cuota del servicio La Ofrenda, ¿para qué fecha podría confirmarme el pago?"

    "Perfecto${this.conversationContext.clientName ? ' señor ' + this.conversationContext.clientName : ''}, queda confirmado su pago del servicio La Ofrenda para el [fecha], muchas gracias por su compromiso"`;

    const res = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt.toLowerCase() },
      ],
      temperature: 0.2,
      max_tokens: 80,
    });

    let text = res.choices?.[0]?.message?.content ?? '';

    // Limpieza y normalización del texto
    text = text
      .replace(/\.\.\./g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?]{2,}/g, '')
      .replace(/\b\d+\b/g, (match) => this.numberToText(match))
      .trim();

    return text;
  }

  // Método para obtener la fecha acordada (útil para el VoiceGateway)
  getAgreedDate(): string | undefined {
    return this.conversationContext.agreedDate;
  }

  // Método para resetear el contexto (nueva conversación)
  resetContext(): void {
    this.conversationContext = {
      serviceName: 'La Ofrenda',
    };
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
