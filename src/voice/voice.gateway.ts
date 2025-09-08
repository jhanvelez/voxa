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
  private isAgentSpeaking: boolean = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private readonly SILENCE_TIMEOUT_MS = 15000;
  private interruptionCount: number = 0;
  private lastInteractionTime: number = Date.now();

  handleConnection(client: WebSocket, req: any) {
    this.logger.log('🔌 Twilio conectado');

    const url = new URL(req.url, 'ws://localhost');
    const customerName = url.searchParams.get('customerName');
    const debtAmount = url.searchParams.get('debtAmount');

    this.logger.log(`📋 Cliente: ${customerName}, Deuda: ${debtAmount}`);

    this.llm.setClientData(customerName, debtAmount);

    let streamSid: string | null = null;
    let callSid: string | null = null;
    let isProcessing = false;

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

            this.resetSilenceTimeout(client, streamSid, callSid);

            setTimeout(async () => {
              if (!this.hasGreeted) {
                await this.sendInitialGreeting(client, streamSid, customerName);
              }
            }, 1000);

            this.deepgram.connect(async (transcript) => {
              if (isProcessing) {
                return;
              }

              this.resetSilenceTimeout(client, streamSid, callSid);

              if (this.isAgentSpeaking && transcript.trim().length > 3) {
                this.logger.log(`🗣️ Usuario interrumpió: ${transcript}`);
                this.interruptionCount++;
                
                if (this.interruptionCount >= 2) {
                  this.isAgentSpeaking = false;
                }
              }

              isProcessing = true;
              this.logger.log(`📝 Transcripción: ${transcript}`);

              if (transcript.trim().length < 3) {
                isProcessing = false;
                return;
              }

              this.interactionCount++;
              this.logger.log(`🔄 Interacción: ${this.interactionCount}`);

              if (this.interactionCount >= 10) {
                this.logger.log('⏰ Límite de interacciones');
                await this.forceCallEnd(client, streamSid, callSid);
                isProcessing = false;
                return;
              }

              if (this.paymentDateAgreed) {
                setTimeout(async () => {
                  await this.endCall(client, streamSid, callSid, this.agreedDate);
                }, 2000);
                isProcessing = false;
                return;
              }

              try {
                const reply = await this.llm.ask(transcript);
                this.logger.log(`🤖 Agente: ${reply}`);

                if (this.isFinalConfirmation(reply)) {
                  this.paymentDateAgreed = true;
                  this.agreedDate = this.extractDate(reply);
                  await this.sendAudioResponse(client, streamSid, reply);
                  setTimeout(() => this.endCall(client, streamSid, callSid, this.agreedDate), 2000);
                  isProcessing = false;
                  return;
                }

                if (this.isUserConfirmation(transcript) && this.consecutiveConfirmations >= 1) {
                  this.paymentDateAgreed = true;
                  this.agreedDate = this.extractDate(reply) || 'próximo día hábil';
                  const finalMessage = `Perfecto confirmo su pago para el ${this.agreedDate} gracias por su compromiso`;
                  await this.sendAudioResponse(client, streamSid, finalMessage);
                  setTimeout(() => this.endCall(client, streamSid, callSid, this.agreedDate), 3000);
                  isProcessing = false;
                  return;
                }

                if (this.isUserConfirmation(transcript)) {
                  this.consecutiveConfirmations++;
                } else {
                  this.consecutiveConfirmations = 0;
                }

                await this.sendAudioResponse(client, streamSid, reply);
              } catch (err) {
                this.logger.error('❌ Error en LLM/TTS', err);
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
                this.resetSilenceTimeout(client, streamSid, callSid);
              }
            } catch (err) {
              this.logger.error('❌ Error procesando audio', err);
            }
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

  private async sendAudioResponse(client: WebSocket, streamSid: string, text: string): Promise<void> {
    try {
      this.isAgentSpeaking = true;
      const mulawBuffer = await this.tts.synthesizeToMuLaw8k(text);
      const chunkSize = 160;

      for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
        if (!this.isAgentSpeaking) {
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

        if (i % (chunkSize * 5) === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    } catch (error) {
      this.logger.error('Error enviando audio:', error);
    } finally {
      this.isAgentSpeaking = false;
    }
  }

  private isFinalConfirmation(llmResponse: string): boolean {
    const finalKeywords = [
      'confirmo', 'acordado', 'perfecto', 'excelente', 'gracias', 
      'queda confirmado', 'muchas gracias', 'finalizado', 'terminamos'
    ];
    
    const hasFinalKeyword = finalKeywords.some(keyword => 
      llmResponse.toLowerCase().includes(keyword)
    );
    
    const hasDate = this.extractDate(llmResponse) !== 'fecha no especificada';
    
    return hasFinalKeyword && hasDate;
  }

  private isUserConfirmation(userTranscript: string): boolean {
    const confirmationWords = [
      'sí', 'si', 'claro', 'por supuesto', 'ok', 'de acuerdo', 
      'confirmo', 'acepto', 'está bien', 'perfecto'
    ];

    return confirmationWords.some(word => 
      userTranscript.toLowerCase().includes(word)
    );
  }

  private extractDate(text: string): string {
    const datePattern = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)|(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i;
    const match = text.match(datePattern);
    return match ? match[0] : 'fecha no especificada';
  }

  private resetSilenceTimeout(client: WebSocket, streamSid: string, callSid: string): void {
    this.clearSilenceTimeout();
    this.timeoutTimer = setTimeout(async () => {
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

  private async handleSilenceTimeout(client: WebSocket, streamSid: string, callSid: string): Promise<void> {
    this.logger.warn('⏰ Timeout por silencio');
    
    if (this.paymentDateAgreed) {
      await this.endCall(client, streamSid, callSid, this.agreedDate);
    } else {
      const timeoutMessage = 'No hemos podido establecer comunicación. Nos contactaremos nuevamente. Que tenga buen día.';
      await this.sendAudioResponse(client, streamSid, timeoutMessage);
      setTimeout(() => this.endCall(client, streamSid, callSid, 'fecha no confirmada'), 2000);
    }
  }

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
    const greeting = `Hola me comunico desde La Ofrenda quería brindarte información sobre tu cuota pendiente`;

    this.logger.log(`🤖 Saludo: ${greeting}`);
    await this.sendAudioResponse(client, streamSid, greeting);
  }

  private async forceCallEnd(client: WebSocket, streamSid: string, callSid: string) {
    const finalMessage = 'Gracias por su tiempo. Nos comunicaremos nuevamente. Que tenga buen día.';
    await this.sendAudioResponse(client, streamSid, finalMessage);
    setTimeout(() => this.endCall(client, streamSid, callSid, 'fecha no confirmada'), 1000);
  }
}