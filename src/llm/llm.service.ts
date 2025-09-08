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
    // Extraer nombre si se menciona
    const nameMatch = prompt.match(
      /(?:me llamo|soy|mi nombre es)\s+([a-záéíóúñ\s]+)/i,
    );
    if (nameMatch && !this.conversationContext.clientIdentified) {
      this.conversationContext.clientName = nameMatch[1].trim();
      this.conversationContext.clientIdentified = true;
      this.conversationContext.conversationState = 'explaining_situation';
    }

    // Extraer fechas mencionadas (día y mes)
    const dateMatch = prompt.match(
      /(\d{1,2})\s*(?:de|\/)\s*([a-záéíóúñ]+|\d{1,2})/i,
    );
    if (dateMatch) {
      const day = dateMatch[1];
      const month = this.normalizeMonth(dateMatch[2]);
      if (month) {
        this.conversationContext.agreedDate = `${day} de ${month}`;
        this.conversationContext.paymentPromiseObtained = true;
        this.conversationContext.conversationState = 'confirming_agreement';
      }
    }

    // Detectar afirmaciones de pago
    if (
      prompt.match(
        /\b(sí|si|claro|por supuesto|acepto|confirmo|ok|de acuerdo)\b/i,
      )
    ) {
      if (this.conversationContext.agreedDate) {
        this.conversationContext.conversationState = 'closing_call';
      }
    }

    // Detectar objeciones o negativas
    if (prompt.match(/\b(no|tengo problemas|no puedo|difícil|complicado)\b/i)) {
      this.conversationContext.conversationState = 'handling_objections';
    }
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

    const today = new Date();
    const currentDate = today.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    // Calcular límite de 5 días hábiles
    const businessDaysLimit = this.calculateBusinessDays(today, 5);
    const limitDateStr = businessDaysLimit.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    // Construir contexto dinámico basado en el estado de la conversación
    let systemContent = `Eres un agente de cobranzas profesional colombiano en una llamada telefónica en tiempo real. Tu objetivo es obtener un compromiso de pago con fecha exacta dentro de los próximos 5 días hábiles.

ESTADO ACTUAL DE LA LLAMADA: ${this.conversationContext.conversationState}
INTENTO DE LLAMADA: ${this.conversationContext.callAttempt}

INFORMACIÓN DEL CLIENTE:
- Servicio: ${this.conversationContext.serviceName}
- Fecha actual: ${currentDate}
- Límite para pago: ${limitDateStr}`;

    if (
      this.conversationContext.clientName &&
      this.conversationContext.clientIdentified
    ) {
      systemContent += `\n- Nombre del cliente: ${this.conversationContext.clientName}`;
    }

    if (this.conversationContext.agreedDate) {
      systemContent += `\n- Fecha acordada: ${this.conversationContext.agreedDate}`;
    }

    systemContent += `\n\nREGLAS ESTRICTAS DE LA CONVERSACIÓN:
1. ESTÁS EN UNA LLAMADA TELEFÓNICA EN TIEMPO REAL - las respuestas deben ser breves y naturales para hablar
2. AVANZA LA CONVERSACIÓN hacia el cierre - no te repitas ni te quedes estancado
3. MÁXIMO 5 DÍAS HÁBILES desde hoy - no aceptes fechas posteriores
4. OBTÉN UNA FECHA ESPECÍFICA - no aceptes vaguedades como "la próxima semana"
5. FORMAL pero CORDIAL - trato de usted, respetuoso pero firme
6. MENCIONA "el servicio La Ofrenda" en cada interacción importante
7. CONFIRMA EXPLÍCITAMENTE el acuerdo final
8. RESUELVE OBJECIONS brevemente y vuelve a pedir la fecha
9. CIERRA LA LLAMADA una vez confirmado el pago
10. LONGITUD: 20-80 palabras por respuesta (natural para hablar)

ESTRATEGIA POR ESTADOS:

INICIAL (saludo): Presentarte, identificar al cliente, mencionar brevemente el motivo
EXPLICACIÓN: Recordar cortésmente la deuda pendiente de "La Ofrenda"
NEGOCIACIÓN: Pedir específicamente una fecha de pago en los próximos 5 días
OBJECIONES: Escuchar, empatizar brevemente, pero insistir en una fecha concreta
CONFIRMACIÓN: Repetir la fecha acordada y pedir confirmación explícita
CIERRE: Agradecer y finalizar la llamada cordialmente

EJEMPLOS DE FRASES EFECTIVAS:
"Buenos días, habla [Nombre] de La Ofrenda, ¿estoy hablando con el señor/la señora [Nombre]?"
"Le recuerdo su compromiso pendiente con nuestro servicio La Ofrenda"
"¿Para qué fecha concreta puedo registrar su pago, señor/señora?"
"Entiendo su situación, pero necesito una fecha específica para regularizar su cuenta"
"Perfecto, queda registrado su pago para el [fecha] del servicio La Ofrenda, ¿puedo confirmar que es correcto?"
"Agradezco su compromiso, que tenga un excelente día"

NO HAGAS:
- No des información financiera detallada
- No prolongues la llamanda innecesariamente
- No uses lenguaje muy técnico
- No insistas más de 2 veces seguidas
- No prometas cosas fuera de tu alcance`;

    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt.toLowerCase() },
        ],
        temperature: 0.3,
        max_tokens: 100,
      });

      let text = res.choices?.[0]?.message?.content ?? '';

      // Limpieza y normalización del texto para habla
      text = this.cleanResponseText(text);

      // Avanzar el estado de la conversación si es apropiado
      this.advanceConversationState();

      return text;
    } catch (error) {
      console.error('Error calling OpenAI:', error);
      return 'Disculpe, estoy teniendo dificultades técnicas. ¿Podría repetir su última respuesta?';
    }
  }

  private cleanResponseText(text: string): string {
    return text
      .replace(/\.\.\./g, ' ') // Eliminar puntos suspensivos
      .replace(/\s+/g, ' ') // Normalizar espacios
      .replace(/[.,;:!?]{2,}/g, '') // Eliminar múltiples signos de puntuación
      .replace(/\b\d{1,2}\b/g, (match) => this.numberToText(match)) // Convertir números a texto
      .replace(/\b(muy|bastante|realmente|absolutamente)\s+/gi, '') // Simplificar adverbios
      .replace(/\s+\./g, '.') // Limpiar espacios antes de puntos
      .trim();
  }

  private advanceConversationState(): void {
    // Lógica para avanzar el estado basado en el progreso
    if (
      this.conversationContext.conversationState === 'confirming_agreement' &&
      this.conversationContext.paymentPromiseObtained
    ) {
      this.conversationContext.conversationState = 'closing_call';
    }

    this.conversationContext.callAttempt += 1;
  }

  private calculateBusinessDays(startDate: Date, daysToAdd: number): Date {
    const result = new Date(startDate);
    let addedDays = 0;

    while (addedDays < daysToAdd) {
      result.setDate(result.getDate() + 1);
      // No contar sábados (6) ni domingos (0)
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
    return this.conversationContext.conversationState === 'closing_call';
  }

  // Método para resetear el contexto
  resetContext(): void {
    this.conversationContext = {
      serviceName: 'La Ofrenda',
      callAttempt: 1,
      conversationState: 'initial_greeting',
      clientIdentified: false,
      paymentPromiseObtained: false,
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
