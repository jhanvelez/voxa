import { OpenAI } from 'openai';

// Definimos un estado claro para la conversación
type ConversationState =
  | 'initial_greeting'
  | 'identifying_client'
  | 'explaining_situation'
  | 'negotiating_date'
  | 'confirming_agreement'
  | 'closing_call'
  | 'handling_objections';

// Tipo para los mensajes del historial de conversación
type ConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export class LlmService {
  private client: OpenAI;
  private conversationContext: {
    clientName?: string;
    originalDueDate?: string;
    agreedDate?: string;
    serviceName: string;
    debtAmount?: string;
    callAttempt: number;
    conversationState: ConversationState;
    clientIdentified: boolean;
    paymentPromiseObtained: boolean;
    conversationHistory: ConversationMessage[];
  };

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.resetContext();
  }

  // Método para configurar los datos del cliente
  setClientData(customerName?: string, debtAmount?: string): void {
    if (customerName) {
      this.conversationContext.clientName = customerName;
      this.conversationContext.clientIdentified = true;
    }
    if (debtAmount) {
      this.conversationContext.debtAmount = debtAmount;
    }
  }

  // Método para extraer y recordar información clave
  private extractContextInfo(prompt: string): void {
    const lowerPrompt = prompt.toLowerCase();
    
    // Extraer nombre si se menciona
    const nameMatch = lowerPrompt.match(
      /(?:me llamo|soy|mi nombre es|yo soy)\s+([a-záéíóúñ\s]+)/i
    );
    if (nameMatch && !this.conversationContext.clientIdentified) {
      this.conversationContext.clientName = nameMatch[1].trim();
      this.conversationContext.clientIdentified = true;
      if (this.conversationContext.conversationState === 'initial_greeting') {
        this.conversationContext.conversationState = 'explaining_situation';
      }
    }

    // Extraer fechas mencionadas (día y mes) - patrones más flexibles
    const datePatterns = [
      /(\d{1,2})\s*(?:de|\/)\s*([a-záéíóúñ]+|\d{1,2})/i,
      /(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i,
      /(pasado mañana|mañana)/i,
      /el\s+(\d{1,2})/i
    ];

    for (const pattern of datePatterns) {
      const dateMatch = lowerPrompt.match(pattern);
      if (dateMatch) {
        let extractedDate = this.parseDateFromInput(dateMatch, lowerPrompt);
        if (extractedDate && this.isValidBusinessDate(extractedDate)) {
          this.conversationContext.agreedDate = extractedDate;
          this.conversationContext.paymentPromiseObtained = true;
          this.conversationContext.conversationState = 'confirming_agreement';
          break;
        }
      }
    }

    // Detectar afirmaciones de pago
    if (lowerPrompt.match(/\b(sí|si|claro|por supuesto|acepto|confirmo|ok|vale|de acuerdo|perfecto)\b/i)) {
      if (this.conversationContext.agreedDate) {
        this.conversationContext.conversationState = 'closing_call';
      } else if (this.conversationContext.conversationState === 'negotiating_date') {
        // Si dice sí pero no dio fecha, pedir fecha específica
        this.conversationContext.conversationState = 'negotiating_date';
      }
    }

    // Detectar objeciones o negativas
    if (lowerPrompt.match(/\b(no|tengo problemas|no puedo|difícil|complicado|es que|pero)\b/i)) {
      this.conversationContext.conversationState = 'handling_objections';
    }

    // Detectar si el cliente quiere terminar la llamada
    if (lowerPrompt.match(/\b(adiós|chao|hasta luego|gracias|nada más)\b/i)) {
      this.conversationContext.conversationState = 'closing_call';
    }
  }

  private parseDateFromInput(match: RegExpMatchArray, prompt: string): string | null {
    const today = new Date();
    
    // Manejar "mañana" y "pasado mañana"
    if (prompt.includes('mañana')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.formatColombianDate(tomorrow);
    }
    
    if (prompt.includes('pasado mañana')) {
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return this.formatColombianDate(dayAfterTomorrow);
    }

    // Manejar días de la semana
    const dayNames: {[key: string]: number} = {
      'lunes': 1, 'martes': 2, 'miércoles': 3, 'jueves': 4, 
      'viernes': 5, 'sábado': 6, 'domingo': 0
    };

    if (match[1] in dayNames) {
      const targetDay = dayNames[match[1].toLowerCase()];
      const result = new Date(today);
      let daysToAdd = (targetDay - today.getDay() + 7) % 7;
      daysToAdd = daysToAdd === 0 ? 7 : daysToAdd; // Si es hoy, pasar al próximo
      result.setDate(result.getDate() + daysToAdd);
      return this.formatColombianDate(result);
    }

    // Manejar fechas numéricas (día de mes)
    if (match[1] && match[2]) {
      const day = parseInt(match[1]);
      const monthInput = match[2].toLowerCase();
      const month = this.normalizeMonth(monthInput);
      
      if (month && day >= 1 && day <= 31) {
        return `${day} de ${month}`;
      }
    }

    return null;
  }

  private formatColombianDate(date: Date): string {
    const months = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    
    const day = date.getDate();
    const month = months[date.getMonth()];
    
    return `${day} de ${month}`;
  }

  private isValidBusinessDate(dateString: string): boolean {
    // Validar que la fecha esté dentro de los próximos 5 días hábiles
    return true; // Por ahora aceptamos todas las fechas válidas
  }

  private normalizeMonth(monthInput: string): string | null {
    const months: { [key: string]: string } = {
      'enero': 'enero', '1': 'enero', '01': 'enero',
      'febrero': 'febrero', '2': 'febrero', '02': 'febrero',
      'marzo': 'marzo', '3': 'marzo', '03': 'marzo',
      'abril': 'abril', '4': 'abril', '04': 'abril',
      'mayo': 'mayo', '5': 'mayo', '05': 'mayo',
      'junio': 'junio', '6': 'junio', '06': 'junio',
      'julio': 'julio', '7': 'julio', '07': 'julio',
      'agosto': 'agosto', '8': 'agosto', '08': 'agosto',
      'septiembre': 'septiembre', '9': 'septiembre', '09': 'septiembre',
      'octubre': 'octubre', '10': 'octubre',
      'noviembre': 'noviembre', '11': 'noviembre',
      'diciembre': 'diciembre', '12': 'diciembre'
    };

    return months[monthInput.toLowerCase()] || null;
  }

  async ask(prompt: string): Promise<string> {
    // Extraer información del contexto
    this.extractContextInfo(prompt);

    // Agregar al historial de conversación
    this.conversationContext.conversationHistory.push({
      role: 'user',
      content: prompt
    });

    // Obtener fecha actual en horario de Colombia (UTC-5)
    const today = new Date();
    const colombiaOffset = -5 * 60; // UTC-5 en minutos
    const colombiaTime = new Date(today.getTime() + colombiaOffset * 60 * 1000);
    
    const currentDate = colombiaTime.toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // Calcular límite de 5 días hábiles en horario Colombia
    const businessDaysLimit = this.calculateBusinessDays(colombiaTime, 5);
    const limitDateStr = businessDaysLimit.toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    // Obtener los próximos 5 días hábiles para referencia
    const nextBusinessDays = this.getNextBusinessDays(colombiaTime, 5);

    // Construir contexto dinámico basado en el estado de la conversación
    let systemContent = `Eres un agente de cobranzas profesional colombiano en una llamada telefónica EN TIEMPO REAL. 
Fecha y hora actual en Colombia: ${currentDate}

ESTADO ACTUAL: ${this.conversationContext.conversationState}
OBJETIVO PRINCIPAL: Obtener un compromiso de pago con FECHA EXACTA dentro de los próximos 5 días hábiles.

INFORMACIÓN ACTUAL:
- Servicio: ${this.conversationContext.serviceName}
- Límite máximo para pago: ${limitDateStr}
- Próximos días hábiles: ${nextBusinessDays.join(', ')}

${this.conversationContext.clientName && this.conversationContext.clientIdentified ? 
`- Cliente: ${this.conversationContext.clientName}` : '- Cliente: Por identificar'}

${this.conversationContext.agreedDate ? 
`- Fecha acordada: ${this.conversationContext.agreedDate}` : '- Fecha acordada: Pendiente'}

REGLAS ESTRICTAS:
1. ESTÁS EN LLAMADA TELEFÓNICA REAL - respuestas breves y naturales (15-30 palabras)
2. NO TE REPITAS - avanza la conversación hacia el objetivo
3. FECHAS VÁLIDAS: Solo acepta ${nextBusinessDays.join(' o ')}
4. OBLIGATORIO: Obtener fecha específica, no vaguedades
5. TRATO: Formal pero cordial, usar "usted"
6. MENCIÓN: "servicio La Ofrenda" en cada interacción clave
7. CONFIRMACIÓN: Verificar explícitamente el acuerdo
8. CIERRE: Terminar llamada una vez confirmado el pago

ESTRATEGIA POR ESTADO:

INICIAL: Saludo breve + identificación + motivo llamada
EXPLICACIÓN: Recordar deuda pendiente (breve y clara)
NEGOCIACIÓN: Pedir fecha CONCRETA entre ${nextBusinessDays.join(' o ')}
OBJECIONES: Escuchar → empatizar → insistir en fecha específica
CONFIRMACIÓN: "¿Confirmo su pago para el [fecha] del servicio La Ofrenda?"
CIERRE: Agradecer y finalizar

EJEMPLOS PRÁCTICOS:
"Buenos días, soy Laura de La Ofrenda, ¿con quién tengo el gusto?"
"Le recuerdo su compromiso pendiente con nuestro servicio"
"¿Para cuál día de esta semana puede concretar el pago? Tenemos disponible ${nextBusinessDays[0]} o ${nextBusinessDays[1]}"
"Entiendo, pero necesito una fecha específica para regularizar su cuenta"
"Perfecto, confirmo su pago para el ${nextBusinessDays[0]} del servicio La Ofrenda, ¿está bien?"
"Queda registrado, agradezco su compromiso. Buen día."

NO PERMITIDO:
- Charla innecesaria o repetitiva
- Aceptar fechas fuera del rango
- Dar información financiera detallada
- Prometer cosas fuera de tu alcance
- Alargar la llamada sin necesidad`;

    try {
      // Preparar mensajes para la API de OpenAI
      const messages: any[] = [
        { role: 'system', content: systemContent },
        ...this.conversationContext.conversationHistory.slice(-6).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      const res = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.4,
        max_tokens: 80,
      });

      let text = res.choices?.[0]?.message?.content ?? '';

      // Limpieza y normalización del texto para habla
      text = this.cleanResponseText(text);

      // Agregar respuesta al historial
      this.conversationContext.conversationHistory.push({
        role: 'assistant',
        content: text
      });

      // Avanzar el estado de la conversación
      this.advanceConversationState();

      return text;
    } catch (error) {
      console.error('Error calling OpenAI:', error);
      return 'Disculpe, estoy teniendo dificultades técnicas. ¿Podría repetir su última respuesta?';
    }
  }

  private getNextBusinessDays(startDate: Date, count: number): string[] {
    const businessDays: string[] = [];
    const current = new Date(startDate);
    let found = 0;

    while (found < count) {
      current.setDate(current.getDate() + 1);
      if (current.getDay() !== 0 && current.getDay() !== 6) { // No fines de semana
        const day = current.getDate();
        const month = current.toLocaleDateString('es-CO', { month: 'long' });
        businessDays.push(`${day} de ${month}`);
        found++;
      }
    }

    return businessDays;
  }

  private cleanResponseText(text: string): string {
    return text
      .replace(/\.\.\./g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?]{2,}/g, '')
      .replace(/\b\d{1,2}\b/g, (match) => this.numberToText(match))
      .replace(/\b(muy|bastante|realmente|absolutamente)\s+/gi, '')
      .replace(/\s+\./g, '.')
      .replace(/^\s*\.\s*/, '')
      .trim();
  }

  private advanceConversationState(): void {
    // Lógica para avanzar el estado basado en el progreso
    switch (this.conversationContext.conversationState) {
      case 'initial_greeting':
        this.conversationContext.conversationState = 'identifying_client';
        break;
      case 'identifying_client':
        this.conversationContext.conversationState = 'explaining_situation';
        break;
      case 'explaining_situation':
        this.conversationContext.conversationState = 'negotiating_date';
        break;
      case 'confirming_agreement':
        if (this.conversationContext.paymentPromiseObtained) {
          this.conversationContext.conversationState = 'closing_call';
        }
        break;
    }

    this.conversationContext.callAttempt += 1;
  }

  private calculateBusinessDays(startDate: Date, daysToAdd: number): Date {
    const result = new Date(startDate);
    let addedDays = 0;

    while (addedDays < daysToAdd) {
      result.setDate(result.getDate() + 1);
      if (result.getDay() !== 0 && result.getDay() !== 6) {
        addedDays++;
      }
    }

    return result;
  }

  // Método para obtener la fecha acordada
  getAgreedDate(): string | undefined {
    return this.conversationContext.agreedDate;
  }

  // Método para verificar si la llamada puede cerrarse
  shouldEndCall(): boolean {
    return this.conversationContext.conversationState === 'closing_call' &&
           this.conversationContext.paymentPromiseObtained;
  }

  // Método para resetear el contexto
  resetContext(): void {
    this.conversationContext = {
      serviceName: 'La Ofrenda',
      callAttempt: 1,
      conversationState: 'initial_greeting',
      clientIdentified: false,
      paymentPromiseObtained: false,
      conversationHistory: []
    };
  }

  private numberToText(numberStr: string): string {
    const numbers: { [key: string]: string } = {
      '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro', '5': 'cinco',
      '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve', '10': 'diez',
      '11': 'once', '12': 'doce', '13': 'trece', '14': 'catorce', '15': 'quince',
      '16': 'dieciséis', '17': 'diecisiete', '18': 'dieciocho', '19': 'diecinueve',
      '20': 'veinte', '21': 'veintiuno', '22': 'veintidós', '23': 'veintitrés',
      '24': 'veinticuatro', '25': 'veinticinco', '26': 'veintiséis', '27': 'veintisiete',
      '28': 'veintiocho', '29': 'veintinueve', '30': 'treinta', '31': 'treinta y uno',
    };

    return numbers[numberStr] || numberStr;
  }
}
