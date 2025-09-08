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

  private paymentDateAgreed: boolean = false;
  private agreedDate: string = '';
  private interactionCount: number = 0;
  private consecutiveConfirmations: number = 0;
  private hasGreeted: boolean = false;
  
  // Nuevas variables para manejo de interrupciones y timeout
  private isAgentSpeaking: boolean = false;
  private currentAudioStream: any = null;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private readonly SILENCE_TIMEOUT_MS = 15000; // 15 segundos de silencio
  private readonly MAX_INTERRUPTIONS = 3;
  private interruptionCount: number = 0;
  private lastInteractionTime: number = Date.now();

  handleConnection(client: WebSocket, req: any) {
    this.logger.log('🔌 Twilio conectado');

    // Extraer parámetros de la URL del WebSocket
    const url = new URL(req.url, 'ws://localhost');
    const customerName = url.searchParams.get('customerName');
    const debtAmount = url.searchParams.get('debtAmount');

    this.logger.log(
      `📋 Parámetros del cliente: nombre=${customerName}, deuda=${debtAmount}`,
    );

    // Configurar datos del cliente en el LLM
    this.llm.setClientData(customerName, debtAmount);

    let streamSid: string | null = null;
    let callSid: string | null = null;
    let isProcessing = false;
    
    // Resetear estados
    this.paymentDateAgreed = false;
    this.agreedDate = '';
    this.interactionCount = 0;
    this.consecutiveConfirmations = 0;
    this.hasGreeted = false;
    this.isAgentSpeaking = false;
    this.interruptionCount = 0;
    this.lastInteractionTime = Date.now();

    // Iniciar timeout de silencio
    this.resetSilenceTimeout(client, streamSid, callSid);

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
            this.logger.log(`🎙️ Stream iniciado (sid=${streamSid})`);
            this.logger.log(`📞 Call SID: ${callSid}`);
            this.logger.log(
              `📋 Datos del start:`,
              JSON.stringify(data.start, null, 2),
            );

            // Reiniciar timeout
            this.resetSilenceTimeout(client, streamSid, callSid);

            // ENVIAR SALUDO INMEDIATAMENTE
            setTimeout(async () => {
              if (!this.hasGreeted) {
                await this.sendInitialGreeting(client, streamSid, customerName);
              }
            }, 1000);

            this.deepgram.connect(async (transcript) => {
              if (isProcessing) {
                this.logger.warn('⚠️ Ya se está procesando una solicitud');
                return;
              }

              // Reiniciar timeout con cada interacción
              this.resetSilenceTimeout(client, streamSid, callSid);

              // Si el agente está hablando y el usuario interrumpe
              if (this.isAgentSpeaking && transcript.trim().length > 2) {
                this.logger.log(`🗣️ Usuario interrumpió: ${transcript}`);
                this.interruptionCount++;
                
                // Detener audio actual inmediatamente
                this.stopCurrentAudio();
                
                // Manejar interrupción excesiva
                if (this.interruptionCount >= this.MAX_INTERRUPTIONS) {
                  this.logger.log('⚠️ Demasiadas interrupciones, terminando llamada');
                  await this.forceCallEnd(client, streamSid, callSid);
                  return;
                }
              }

              isProcessing = true;
              this.logger.log(`📝 Transcripción completa: ${transcript}`);

              if (transcript.trim().length < 3) {
                isProcessing = false;
                return;
              }

              this.interactionCount++;
              this.logger.log(
                `🔄 Interacción número: ${this.interactionCount}`,
              );

              if (this.interactionCount >= 7) {
                this.logger.log(
                  '⏰ Límite de interacciones alcanzado, cerrando llamada',
                );
                await this.forceCallEnd(client, streamSid, callSid);
                isProcessing = false;
                return;
              }

              if (this.paymentDateAgreed) {
                this.logger.log('✅ Fecha ya acordada, terminando llamada...');
                setTimeout(async () => {
                  await this.endCall(
                    client,
                    streamSid,
                    callSid,
                    this.agreedDate,
                  );
                }, 4000);
                isProcessing = false;
                return;
              }

              try {
                const reply = await this.llm.ask(transcript);
                this.logger.log(`🤖 Respuesta LLM: ${reply}`);

                // Detectar si es confirmación final del agente
                if (this.isFinalConfirmation(reply)) {
                  this.paymentDateAgreed = true;
                  this.agreedDate = this.extractDate(reply);
                  this.logger.log(`📅 Fecha acordada: ${this.agreedDate}`);

                  // Enviar confirmación final y terminar
                  await this.sendAudioResponse(client, streamSid, reply);
                  setTimeout(async () => {
                    await this.endCall(
                      client,
                      streamSid,
                      callSid,
                      this.agreedDate,
                    );
                  }, 4000);
                  isProcessing = false;
                  return;
                }

                // Detectar confirmaciones consecutivas del usuario
                if (this.isUserConfirmation(transcript)) {
                  this.consecutiveConfirmations++;
                  this.logger.log(
                    `🔄 Confirmaciones consecutivas: ${this.consecutiveConfirmations}`,
                  );

                  if (this.consecutiveConfirmations >= 1) {
                    this.paymentDateAgreed = true;
                    this.agreedDate = this.extractDateFromContext(
                      transcript,
                      reply,
                    );
                    this.logger.log(`📅 Fecha inferida: ${this.agreedDate}`);

                    const finalMessage = `Perfecto confirmo su pago para el ${this.agreedDate} gracias por su compromiso`;
                    await this.sendAudioResponse(
                      client,
                      streamSid,
                      finalMessage,
                    );
                    setTimeout(async () => {
                      await this.endCall(
                        client,
                        streamSid,
                        callSid,
                        this.agreedDate,
                      );
                    }, 4000);
                    isProcessing = false;
                    return;
                  }
                } else {
                  this.consecutiveConfirmations = 0;
                }

                // Respuesta normal
                await this.sendAudioResponse(client, streamSid, reply);
              } catch (err) {
                this.logger.error('❌ Error en pipeline LLM/TTS', err);
              } finally {
                isProcessing = false;
              }
            });
            break;

          case 'media':
            if (!data.media?.payload) {
              this.logger.warn('⚠️ Evento media sin payload válido');
              return;
            }

            try {
              const mulawBuffer = Buffer.from(data.media.payload, 'base64');

              if (mulawBuffer.length > 0 && this.deepgram.isConnected) {
                this.deepgram.sendAudioChunk(mulawBuffer);
                
                // Reiniciar timeout con cada chunk de audio recibido
                this.resetSilenceTimeout(client, streamSid, callSid);
              }
            } catch (err) {
              this.logger.error('❌ Error procesando audio', err);
            }
            break;

          case 'stop':
            this.logger.log(`⏹️ Stream detenido (sid=${streamSid})`);
            this.deepgram.stop();
            isProcessing = false;
            this.clearSilenceTimeout();
            break;
        }
      } catch (err) {
        this.logger.error('❌ Error general', err);
      }
    });

    client.on('close', () => {
      this.logger.log('❌ Twilio desconectado');
      this.deepgram.stop();
      this.clearSilenceTimeout();
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Cliente desconectado');
    this.deepgram.stop();
    this.clearSilenceTimeout();
    client.terminate();
  }

  // Método para enviar respuesta de audio con manejo de interrupciones
  private async sendAudioResponse(
    client: WebSocket,
    streamSid: string,
    text: string,
  ): Promise<void> {
    try {
      this.isAgentSpeaking = true;
      const mulawBuffer = await this.tts.synthesizeToMuLaw8k(text);
      const chunkSize = 160;

      // Guardar referencia al stream actual
      this.currentAudioStream = {
        client,
        streamSid,
        buffer: mulawBuffer,
        position: 0
      };

      // Enviar chunks más eficientemente con posibilidad de interrupción
      for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
        // Verificar si hubo interrupción
        if (!this.isAgentSpeaking) {
          this.logger.log('⏹️ Audio interrumpido por usuario');
          break;
        }

        const chunk = mulawBuffer.subarray(i, i + chunkSize);

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

        // Pequeña pausa entre chunks para permitir interrupciones
        if (i % (chunkSize * 5) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Marcar que el agente terminó de hablar
      this.isAgentSpeaking = false;
      this.currentAudioStream = null;

    } catch (error) {
      this.logger.error('Error sending audio response:', error);
      this.isAgentSpeaking = false;
      this.currentAudioStream = null;
    }
  }

  // Detener audio actual inmediatamente
  private stopCurrentAudio(): void {
    this.isAgentSpeaking = false;
    this.currentAudioStream = null;
  }

  // Manejo de timeout por silencio
  private resetSilenceTimeout(client: WebSocket, streamSid: string | null, callSid: string | null): void {
    // Limpiar timeout anterior
    this.clearSilenceTimeout();
    
    // Establecer nuevo timeout
    this.timeoutTimer = setTimeout(async () => {
      this.logger.warn('⏰ Timeout por silencio - Cerrando llamada');
      await this.handleSilenceTimeout(client, streamSid, callSid);
    }, this.SILENCE_TIMEOUT_MS);
    
    this.lastInteractionTime = Date.now();
  }

  private clearSilenceTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private async handleSilenceTimeout(client: WebSocket, streamSid: string | null, callSid: string | null): Promise<void> {
    if (this.paymentDateAgreed) {
      // Si ya se acordó fecha, simplemente terminar
      await this.endCall(client, streamSid, callSid, this.agreedDate);
    } else {
      // Si no hay acuerdo, enviar mensaje de despedida
      const timeoutMessage = 'No hemos podido establecer comunicación. Nos contactaremos nuevamente. Que tenga buen día.';
      await this.sendAudioResponse(client, streamSid, timeoutMessage);
      
      setTimeout(async () => {
        await this.endCall(client, streamSid, callSid, 'fecha no confirmada');
      }, 3000);
    }
  }

  // Detectar confirmación final del agente
  private isFinalConfirmation(llmResponse: string): boolean {
    const finalKeywords = [
      'confirmo',
      'acordado',
      'quedamos',
      'programado',
      'perfecto',
      'excelente',
      'gracias',
      'finalizado',
      'terminamos',
      'queda confirmado',
      'muchas gracias',
    ];

    const hasFinalKeyword = finalKeywords.some((keyword) =>
      llmResponse.toLowerCase().includes(keyword),
    );

    const hasDate = this.extractDate(llmResponse) !== 'fecha no especificada';

    return hasFinalKeyword && hasDate;
  }

  // Detectar confirmación del usuario
  private isUserConfirmation(userTranscript: string): boolean {
    const confirmationWords = [
      'sí',
      'si',
      'claro',
      'por supuesto',
      'ok',
      'okey',
      'de acuerdo',
      'confirmo',
      'acepto',
      'está bien',
      'perfecto',
      'excelente',
    ];

    return confirmationWords.some((word) =>
      userTranscript.toLowerCase().includes(word),
    );
  }

  // Extraer fecha del contexto
  private extractDateFromContext(
    userTranscript: string,
    llmResponse: string,
  ): string {
    // Primero intentar extraer de la respuesta del LLM
    const llmDate = this.extractDate(llmResponse);
    if (llmDate !== 'fecha no especificada') {
      return llmDate;
    }

    // Si no, buscar en el historial o usar fecha por defecto
    const datePattern =
      /(lunes|martes|miércoles|jueves|viernes|sábado|domingo)|(\d{1,2}\s+de\s+[a-z]+)/i;
    const match = userTranscript.match(datePattern);

    return match ? match[0] : 'próximo día hábil';
  }

  private extractDate(text: string): string {
    const datePattern =
      /(lunes|martes|miércoles|jueves|viernes|sábado|domingo)|(\d{1,2}\s+de\s+[a-z]+)/i;
    const match = text.match(datePattern);
    return match ? match[0] : 'fecha no especificada';
  }

  private async endCall(
    client: WebSocket,
    streamSid: string,
    callSid: string,
    agreedDate: string,
  ) {
    this.logger.log(`📞 Terminando llamada. Fecha acordada: ${agreedDate}`);

    try {
      // Limpiar timeout
      this.clearSilenceTimeout();

      // Primero enviamos el stop al stream de WebSocket
      client.send(
        JSON.stringify({
          event: 'stop',
          streamSid,
        }),
      );

      // Luego hacemos hangup de la llamada en Twilio
      if (callSid) {
        const hangupResult = await this.twilio.hangupCall(callSid);
        if (hangupResult) {
          this.logger.log('🛑 Llamada colgada exitosamente en Twilio');
        } else {
          this.logger.error('❌ Error colgando llamada en Twilio');
        }
      }

      this.logger.log('🛑 Llamada finalizada exitosamente');
    } catch (err) {
      this.logger.error('❌ Error terminando llamada', err);
    }
  }

  private async sendInitialGreeting(
    client: WebSocket,
    streamSid: string,
    customerName?: string,
  ): Promise<void> {
    if (this.hasGreeted) return;

    this.hasGreeted = true;

    // Personalizar saludo con el nombre del cliente
    const name = customerName || 'Guillermo';
    const greeting = `Hola, ${name} me comunico desde La Ofrenda, quería brindarte información sobre tu cuota pendiente y aclarar si tienes preguntas o dudas.`;

    this.logger.log(`🤖 Saludo inicial: ${greeting}`);
    await this.sendAudioResponse(client, streamSid, greeting);
  }

  private async forceCallEnd(
    client: WebSocket,
    streamSid: string,
    callSid: string,
  ): Promise<void> {
    const finalMessage =
      'Gracias por su tiempo. Nos comunicaremos nuevamente. Que tenga buen día.';
    await this.sendAudioResponse(client, streamSid, finalMessage);

    setTimeout(() => {
      this.endCall(client, streamSid, callSid, 'fecha no confirmada');
    }, 1000);
  }
}
