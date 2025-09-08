import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import WebSocket, { Server } from 'ws';
import { DeepgramService } from '../deepgram/deepgram.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import { TwilioService } from '../twilio/twilio.service';

@WebSocketGateway({ path: '/voice-stream' })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private deepgram: DeepgramService,
    private llm: LlmService,
    private tts: TtsService,
    private twilio: TwilioService,
  ) {}

  @WebSocketServer()
  server: Server;

  // Estados de la llamada
  private paymentDateAgreed: boolean = false;
  private agreedDate: string = '';
  private interactionCount: number = 0;
  private consecutiveConfirmations: number = 0;
  private hasGreeted: boolean = false;
  
  // Control de audio y tiempo
  private isAgentSpeaking: boolean = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private readonly SILENCE_TIMEOUT_MS = 15000; // 15 segundos
  private interruptionCount: number = 0;
  private lastInteractionTime: number = Date.now();

  handleConnection(client: WebSocket, req: any) {
    this.logger.log('🔌 Twilio conectado');

    // Extraer parámetros de la URL
    const url = new URL(req.url, 'ws://localhost');
    const customerName = url.searchParams.get('customerName');
    const debtAmount = url.searchParams.get('debtAmount');

    this.logger.log(`📋 Cliente: ${customerName}, Deuda: ${debtAmount}`);

    // Configurar LLM
    this.llm.setClientData(customerName, debtAmount);

    let streamSid: string | null = null;
    let callSid: string | null = null;
    let isProcessingUserInput = false;

    // Resetear estados
    this.resetCallState();

    client.on('message', async (message: Buffer) => {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch {
        this.logger.warn('⚠️ Mensaje JSON inválido');
        return;
      }

      try {
        switch (data.event) {
          case 'start':
            this.deepgram.stop();
            streamSid = data.start.streamSid;
            callSid = data.start.callSid;
            this.logger.log(`🎙️ Stream iniciado: ${streamSid}`);

            // Reiniciar timeout
            this.resetSilenceTimeout(() => {
              this.handleSilenceTimeout(client, streamSid, callSid);
            });

            // Saludo inicial con delay mínimo
            setTimeout(async () => {
              if (!this.hasGreeted) {
                await this.sendInitialGreeting(client, streamSid, customerName);
              }
            }, 500);

            // Configurar Deepgram
            this.setupDeepgram(client, streamSid, callSid, () => isProcessingUserInput);
            break;

          case 'media':
            this.handleMediaEvent(data);
            break;

          case 'stop':
            this.logger.log(`⏹️ Stream detenido: ${streamSid}`);
            this.deepgram.stop();
            this.clearSilenceTimeout();
            break;
        }
      } catch (err) {
        this.logger.error('❌ Error general', err);
      }
    });

    client.on('close', () => {
      this.logger.log('❌ Twilio desconectado');
      this.cleanupConnection();
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Cliente desconectado');
    this.cleanupConnection();
    client.terminate();
  }

  // ========== MÉTODOS PRINCIPALES ==========

  private setupDeepgram(client: WebSocket, streamSid: string, callSid: string, isProcessingUserInput: () => boolean) {
    this.deepgram.connect(async (transcript) => {
      // Reiniciar timeout con cada interacción
      this.resetSilenceTimeout(() => {
        this.handleSilenceTimeout(client, streamSid, callSid);
      });

      // Ignorar transcripciones cortas durante speech del agente
      if (this.isAgentSpeaking && transcript.trim().length < 5) {
        return;
      }

      // Si el agente está hablando y usuario interrumpe significativamente
      if (this.isAgentSpeaking && transcript.trim().length > 3) {
        this.logger.log(`🗣️ Interrupción: ${transcript}`);
        this.interruptionCount++;
        
        // Solo interrumpir después de múltiples interrupciones
        if (this.interruptionCount >= 2) {
          this.isAgentSpeaking = false;
        }
      }

      if (isProcessingUserInput() || transcript.trim().length < 2) {
        return;
      }

      await this.processUserInput(transcript, client, streamSid, callSid);
    });
  }

  private async processUserInput(transcript: string, client: WebSocket, streamSid: string, callSid: string) {
    this.logger.log(`📝 Usuario: ${transcript}`);
    this.interactionCount++;

    // Límite de interacciones
    if (this.interactionCount >= 10) {
      this.logger.log('⏰ Límite de interacciones');
      await this.forceCallEnd(client, streamSid, callSid);
      return;
    }

    // Si ya se acordó fecha
    if (this.paymentDateAgreed) {
      await this.endCall(client, streamSid, callSid, this.agreedDate);
      return;
    }

    try {
      const reply = await this.llm.ask(transcript);
      this.logger.log(`🤖 Agente: ${reply}`);

      // Verificar si es confirmación final DEL AGENTE
      if (this.isAgentFinalConfirmation(reply)) {
        this.paymentDateAgreed = true;
        this.agreedDate = this.extractDate(reply);
        await this.sendAudioResponse(client, streamSid, reply);
        setTimeout(() => this.endCall(client, streamSid, callSid, this.agreedDate), 2000);
        return;
      }

      // Verificar si es confirmación del USUARIO después de una propuesta de fecha
      if (this.isUserConfirmingDate(transcript, reply)) {
        this.paymentDateAgreed = true;
        this.agreedDate = this.extractDateFromContext(transcript, reply);
        const finalConfirmation = `Perfecto, confirmo su pago para el ${this.agreedDate} del servicio La Ofrenda. Muchas gracias por su compromiso.`;
        await this.sendAudioResponse(client, streamSid, finalConfirmation);
        setTimeout(() => this.endCall(client, streamSid, callSid, this.agreedDate), 3000);
        return;
      }

      // Enviar respuesta normal
      await this.sendAudioResponse(client, streamSid, reply);

    } catch (err) {
      this.logger.error('❌ Error en LLM/TTS', err);
    }
  }

  // ========== DETECCIÓN DE CONFIRMACIONES ==========

  private isAgentFinalConfirmation(llmResponse: string): boolean {
    const finalKeywords = [
      'confirmo', 'acordado', 'perfecto', 'excelente', 'gracias', 
      'queda confirmado', 'muchas gracias', 'finalizado', 'terminamos',
      'quedamos', 'registrado', 'aprobado', 'confirmado'
    ];
    
    const hasFinalKeyword = finalKeywords.some(keyword => 
      llmResponse.toLowerCase().includes(keyword)
    );
    
    const hasDate = this.extractDate(llmResponse) !== 'fecha no especificada';
    const hasThankYou = llmResponse.toLowerCase().includes('gracias');
    const hasGoodbye = llmResponse.toLowerCase().includes('buen día') || 
                      llmResponse.toLowerCase().includes('adiós') ||
                      llmResponse.toLowerCase().includes('hasta luego');

    return (hasFinalKeyword && hasDate) || (hasThankYou && hasGoodbye && hasDate);
  }

  private isUserConfirmingDate(userTranscript: string, agentResponse: string): boolean {
    // Verificar si el agente acaba de proponer una fecha
    const agentProposedDate = this.extractDate(agentResponse) !== 'fecha no especificada';
    const agentAskingConfirmation = agentResponse.toLowerCase().includes('¿está de acuerdo?') ||
                                  agentResponse.toLowerCase().includes('¿le parece bien?') ||
                                  agentResponse.toLowerCase().includes('confirmamos?');

    // Verificar confirmación del usuario
    const userConfirmation = this.isUserConfirmation(userTranscript);
    
    return agentProposedDate && agentAskingConfirmation && userConfirmation;
  }

  private isUserConfirmation(userTranscript: string): boolean {
    const confirmationWords = [
      'sí', 'si', 'claro', 'por supuesto', 'ok', 'okey', 'de acuerdo', 
      'confirmo', 'acepto', 'está bien', 'perfecto', 'excelente', 'vale',
      'correcto', 'afirmativo', 'me parece bien', 'estoy de acuerdo'
    ];

    const userText = userTranscript.toLowerCase();
    
    // Buscar palabras de confirmación
    const hasConfirmationWord = confirmationWords.some(word => 
      userText.includes(word)
    );

    // Buscar patrones de confirmación más complejos
    const confirmationPatterns = [
      /sí.*(señor|señora|amigo|amiga)/i,
      /claro que sí/i,
      /por supuesto que sí/i,
      /me parece bien/i,
      /estoy de acuerdo/i,
      /(está|esta) bien/i,
      /(vale|ok|okey).*(sí|si)/i
    ];

    const hasConfirmationPattern = confirmationPatterns.some(pattern => 
      pattern.test(userText)
    );

    return hasConfirmationWord || hasConfirmationPattern;
  }

  // ========== MANEJO DE FECHAS ==========

  private extractDate(text: string): string {
    const datePatterns = [
      /(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i,
      /(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i,
      /(mañana|pasado mañana)/i,
      /el\s+(\d{1,2})/i,
      /(\d{1,2})\s*\/\s*(\d{1,2})/i
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        // Convertir "mañana" y "pasado mañana" a fechas concretas
        if (match[0].toLowerCase().includes('mañana')) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          return this.formatDate(tomorrow);
        }
        return match[0];
      }
    }

    return 'fecha no especificada';
  }

  private formatDate(date: Date): string {
    const day = date.getDate();
    const month = date.toLocaleDateString('es-ES', { month: 'long' });
    return `${day} de ${month}`;
  }

  private extractDateFromContext(userTranscript: string, llmResponse: string): string {
    // Primero intentar extraer de la respuesta del LLM
    const llmDate = this.extractDate(llmResponse);
    if (llmDate !== 'fecha no especificada') {
      return llmDate;
    }

    // Buscar en el historial de la conversación
    const userDate = this.extractDate(userTranscript);
    if (userDate !== 'fecha no especificada') {
      return userDate;
    }

    // Si no encuentra fecha, usar la fecha actual + 3 días hábiles
    const futureDate = new Date();
    let businessDays = 0;
    while (businessDays < 3) {
      futureDate.setDate(futureDate.getDate() + 1);
      if (futureDate.getDay() !== 0 && futureDate.getDay() !== 6) {
        businessDays++;
      }
    }
    
    return this.formatDate(futureDate);
  }

  // ========== MANEJO DE AUDIO ==========

  private async sendAudioResponse(
    client: WebSocket,
    streamSid: string,
    text: string,
  ): Promise<void> {
    try {
      this.isAgentSpeaking = true;
      const mulawBuffer = await this.tts.synthesizeToMuLaw8k(text);
      
      // Enviar audio en chunks
      const chunkSize = 320;
      const totalChunks = Math.ceil(mulawBuffer.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        // Verificar si debemos parar (interrupción)
        if (!this.isAgentSpeaking) {
          break;
        }

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, mulawBuffer.length);
        const chunk = mulawBuffer.subarray(start, end);

        client.send(
          JSON.stringify({
            event: 'media',
            streamSid,
            media: {
              payload: chunk.toString('base64'),
              track: 'inbound',
            },
          }),
        );

        // Pequeña pausa para no saturar
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }

    } catch (error) {
      this.logger.error('Error enviando audio:', error);
    } finally {
      this.isAgentSpeaking = false;
    }
  }

  private handleMediaEvent(data: any) {
    if (!data.media?.payload) {
      this.logger.warn('⚠️ Media sin payload');
      return;
    }

    try {
      const mulawBuffer = Buffer.from(data.media.payload, 'base64');
      if (mulawBuffer.length > 0 && this.deepgram.isConnected) {
        this.deepgram.sendAudioChunk(mulawBuffer);
      }
    } catch (err) {
      this.logger.error('❌ Error procesando audio', err);
    }
  }

  // ========== MANEJO DE TIMEOUT ==========

  private resetSilenceTimeout(timeoutCallback: () => void): void {
    this.clearSilenceTimeout();
    this.timeoutTimer = setTimeout(timeoutCallback, this.SILENCE_TIMEOUT_MS);
    this.lastInteractionTime = Date.now();
  }

  private clearSilenceTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private async handleSilenceTimeout(client: WebSocket, streamSid: string | null, callSid: string | null): Promise<void> {
    this.logger.warn('⏰ Timeout por silencio');
    
    if (this.paymentDateAgreed) {
      await this.endCall(client, streamSid, callSid, this.agreedDate);
    } else {
      const timeoutMessage = 'No hemos podido establecer comunicación. Nos contactaremos nuevamente. Que tenga buen día.';
      await this.sendAudioResponse(client, streamSid, timeoutMessage);
      setTimeout(() => this.endCall(client, streamSid, callSid, 'fecha no confirmada'), 2000);
    }
  }

  // ========== MÉTODOS AUXILIARES ==========

  private resetCallState(): void {
    this.paymentDateAgreed = false;
    this.agreedDate = '';
    this.interactionCount = 0;
    this.consecutiveConfirmations = 0;
    this.hasGreeted = false;
    this.isAgentSpeaking = false;
    this.interruptionCount = 0;
    this.lastInteractionTime = Date.now();
  }

  private cleanupConnection(): void {
    this.deepgram.stop();
    this.clearSilenceTimeout();
    this.isAgentSpeaking = false;
  }

  private async endCall(client: WebSocket, streamSid: string, callSid: string, agreedDate: string) {
    this.logger.log(`📞 Terminando llamada. Fecha: ${agreedDate}`);
    this.clearSilenceTimeout();

    try {
      client.send(JSON.stringify({ event: 'stop', streamSid }));

      if (callSid) {
        await this.twilio.hangupCall(callSid);
        this.logger.log('🛑 Llamada finalizada');
      }
    } catch (err) {
      this.logger.error('❌ Error terminando llamada', err);
    }
  }

  private async sendInitialGreeting(client: WebSocket, streamSid: string, customerName?: string) {
    if (this.hasGreeted) return;
    this.hasGreeted = true;

    const name = customerName || 'cliente';
    const greeting = `Hola ${name} me comunico desde La Ofrenda, quería brindarte información sobre tu cuota pendiente.`;

    this.logger.log(`🤖 Saludo: ${greeting}`);
    await this.sendAudioResponse(client, streamSid, greeting);
  }

  private async forceCallEnd(client: WebSocket, streamSid: string, callSid: string) {
    const finalMessage = 'Gracias por su tiempo. Nos comunicaremos nuevamente. Que tenga buen día.';
    await this.sendAudioResponse(client, streamSid, finalMessage);
    setTimeout(() => this.endCall(client, streamSid, callSid, 'fecha no confirmada'), 1000);
  }
}