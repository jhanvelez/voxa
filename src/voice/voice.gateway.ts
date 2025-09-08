// IMPORTS iguales a los tuyos
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

  // Estado de llamada
  private paymentDateAgreed = false;
  private agreedDate = '';
  private interactionCount = 0;
  private consecutiveConfirmations = 0;
  private hasGreeted = false;
  private isAgentSpeaking = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private readonly SILENCE_TIMEOUT_MS = 15000;
  private interruptionCount = 0;
  private lastInteractionTime = Date.now();

  // Nueva: cola simple FIFO para transcripciones
  private transcriptQueue: string[] = [];
  private processingQueue = false;

  // Nueva: referencia a la promesa TTS actual para poder esperar/cancelar
  private currentTtsPromise: Promise<void> | null = null;
  private cancelCurrentTts = false;

  handleConnection(client: WebSocket, req: any) {
    this.logger.log('🔌 Twilio conectado');

    const url = new URL(req.url, 'ws://localhost');
    const customerName = url.searchParams.get('customerName');
    const debtAmount = url.searchParams.get('debtAmount');

    this.logger.log(`📋 Cliente: ${customerName}, Deuda: ${debtAmount}`);
    this.llm.setClientData(customerName, debtAmount);

    let streamSid: string | null = null;
    let callSid: string | null = null;

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

            // Conectar transcripción - asumimos que deepgram.connect ejecuta callback por cada transcript
            this.deepgram.connect((transcript: string) => {
              // cada transcript va a la cola
              if (!transcript || transcript.trim().length < 1) return;
              this.transcriptQueue.push(transcript);
              this.resetSilenceTimeout(client, streamSid, callSid);

              // si el usuario habla mientras el agente está hablando cancelamos TTS inmediatamente
              if (this.isAgentSpeaking) {
                this.logger.log('🗣️ Interrupción detectada - cancelando TTS activo');
                this.cancelCurrentTts = true;
                // cuenta interrupciones (si quieres lógica más compleja)
                this.interruptionCount++;
              }

              // procesar cola (si no está procesando)
              if (!this.processingQueue) {
                this.processTranscriptQueue(client, streamSid, callSid);
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
      // cancelar TTS si hay
      this.cancelCurrentTts = true;
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Cliente desconectado');
    this.deepgram.stop();
    this.clearSilenceTimeout();
    client.terminate();
  }

  // --- Cola de transcripciones ---
  private async processTranscriptQueue(client: WebSocket, streamSid: string, callSid: string) {
    this.processingQueue = true;
    while (this.transcriptQueue.length > 0) {
      const transcript = this.transcriptQueue.shift();
      if (!transcript) continue;

      this.interactionCount++;
      this.logger.log(`🔄 Interacción: ${this.interactionCount} -> ${transcript}`);

      if (this.interactionCount >= 10) {
        this.logger.log('⏰ Límite de interacciones');
        await this.forceCallEnd(client, streamSid, callSid);
        break;
      }

      if (this.paymentDateAgreed) {
        await this.endCall(client, streamSid, callSid, this.agreedDate);
        break;
      }

      try {
        // Llamada LLM
        const reply = await this.llm.ask(transcript);
        this.logger.log(`🤖 Agente: ${reply}`);

        // Lógica de confirmaciones (igual que la tuya)
        if (this.isFinalConfirmation(reply)) {
          this.paymentDateAgreed = true;
          this.agreedDate = this.extractDate(reply);
          await this.sendAudioResponse(client, streamSid, reply);
          await this.waitForTtsToFinishOrTimeout(8000); // espera segura
          await this.endCall(client, streamSid, callSid, this.agreedDate);
          break;
        }

        if (this.isUserConfirmation(transcript) && this.consecutiveConfirmations >= 1) {
          this.paymentDateAgreed = true;
          this.agreedDate = this.extractDate(reply) || 'próximo día hábil';
          const finalMessage = `Perfecto confirmo su pago para el ${this.agreedDate} gracias por su compromiso`;
          await this.sendAudioResponse(client, streamSid, finalMessage);
          await this.waitForTtsToFinishOrTimeout(8000);
          await this.endCall(client, streamSid, callSid, this.agreedDate);
          break;
        }

        if (this.isUserConfirmation(transcript)) {
          this.consecutiveConfirmations++;
        } else {
          this.consecutiveConfirmations = 0;
        }

        await this.sendAudioResponse(client, streamSid, reply);
      } catch (err) {
        this.logger.error('❌ Error en LLM/TTS', err);
      }
    }
    this.processingQueue = false;
  }

  // --- Envío de audio con control de cancelación y backpressure ---
  private async sendAudioResponse(client: WebSocket, streamSid: string, text: string): Promise<void> {
    // si el socket no está abierto, salir
    if (!client || (client.readyState !== WebSocket.OPEN)) {
      this.logger.warn('Socket no abierto, no se puede enviar TTS');
      return;
    }

    this.cancelCurrentTts = false;
    this.isAgentSpeaking = true;

    // Guardamos la promesa para que otros métodos puedan esperarla
    const promise = (async () => {
      try {
        const mulawBuffer = await this.tts.synthesizeToMuLaw8k(text); // Buffer
        const chunkSize = 160; // mantén tu chunk size

        for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
          if (this.cancelCurrentTts) {
            this.logger.log('TTS cancelado por nueva entrada');
            break;
          }

          const chunk = mulawBuffer.subarray(i, i + chunkSize);
          // comprobar estado del socket
          if (client.readyState !== WebSocket.OPEN) {
            this.logger.warn('Socket cerrado mientras enviaba audio');
            break;
          }

          // enviar chunk
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

          // CONTROL DE BACKPRESSURE: si hay bufferedAmount alta, esperamos
          // bufferedAmount es número de bytes sin enviar aún
          if ((client as any).bufferedAmount && (client as any).bufferedAmount > 64 * 1024) {
            // si hay mucho buffer, espera un poquito
            await new Promise(resolve => setTimeout(resolve, 20));
          } else {
            // pequeña espera para evitar "burst" extremo y dar tiempo a Twilio
            await new Promise(resolve => setTimeout(resolve, 6));
          }
        }
      } catch (error) {
        this.logger.error('Error enviando audio:', error);
      } finally {
        this.isAgentSpeaking = false;
      }
    })();

    this.currentTtsPromise = promise;
    await promise;
    this.currentTtsPromise = null;
  }

  private async waitForTtsToFinishOrTimeout(timeoutMs = 5000) {
    const start = Date.now();
    while (this.isAgentSpeaking) {
      if (Date.now() - start > timeoutMs) {
        this.logger.warn('Timeout esperando a que TTS termine');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
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
      await this.waitForTtsToFinishOrTimeout(7000);
      await this.endCall(client, streamSid, callSid, 'fecha no confirmada');
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
    this.transcriptQueue = [];
    this.processingQueue = false;
    this.cancelCurrentTts = false;
  }

  private async endCall(client: WebSocket, streamSid: string, callSid: string, agreedDate: string) {
    this.logger.log(`📞 Terminando llamada. Fecha: ${agreedDate}`);
    this.clearSilenceTimeout();

    try {
      // enviar evento stop al stream (Twilio)
      client.send(JSON.stringify({ event: 'stop', streamSid }));

      // esperar a que termine TTS activo (o forzarlo después de timeout)
      await this.waitForTtsToFinishOrTimeout(5000);

      if (callSid) {
        await this.twilio.hangupCall(callSid);
        this.logger.log('🛑 Llamada finalizada');
      }
    } catch (err) {
      this.logger.error('❌ Error terminando llamada', err);
    } finally {
      // asegurar estado limpio
      this.cancelCurrentTts = true;
      this.isAgentSpeaking = false;
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
    await this.waitForTtsToFinishOrTimeout(4000);
    await this.endCall(client, streamSid, callSid, 'fecha no confirmada');
  }
}
