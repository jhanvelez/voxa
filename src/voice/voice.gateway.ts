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
import { decode } from 'mulaw-js';

@WebSocketGateway({ path: '/voice-stream' })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private deepgram: DeepgramService,
    private llm: LlmService,
    private tts: TtsService,
  ) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: WebSocket) {
    this.logger.log('🔌 Twilio conectado');
    let streamSid: string | null = null;
    let isProcessing = false;
    let mulawBufferCounter = undefined;
    const SILENCE_THRESHOLD = 200;

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
            this.logger.log(`🎙️ Stream iniciado (sid=${streamSid})`);

            this.deepgram.connect(async (transcript) => {
              if (isProcessing) {
                this.logger.warn('⚠️ Ya se está procesando una solicitud');
                return;
              }

              isProcessing = true;
              this.logger.log(`📝 Transcripción completa: ${transcript}`);

              try {
                const reply = await this.llm.ask(transcript);
                this.logger.log(`🤖 Respuesta LLM: ${reply}`);

                // Sintetizar audio
                const mulawBuffer = await this.tts.synthesizeToMuLaw8k(reply);

                // Enviar audio en chunks
                const chunkSize = 160;
                for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
                  const chunk = mulawBuffer.subarray(i, i + chunkSize);
                  await new Promise((resolve) => setTimeout(resolve, 10)); // Pequeña pausa
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
                }
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

              const pcm16 = decode(mulawBuffer);

              let sumSquares = 0;
              for (let i = 0; i < pcm16.length; i++) {
                sumSquares += pcm16[i] * pcm16[i];
              }
              const rms = Math.sqrt(sumSquares / pcm16.length);

              /*
              this.logger.log(
                `🔇 Volumen del paquete del audio capturado: ${rms}.`,
              );
              */

              if (rms < SILENCE_THRESHOLD) {
                // Aqui se entra cuando se encuentre un silencio:
                setTimeout(() => {
                  this.logger.log(
                    `Tamano del paquete real: ${mulawBufferCounter.length}`,
                  );

                  if (mulawBufferCounter.length > 200) {
                    // Enviarlo
                  }
                  mulawBufferCounter = undefined;
                  this.logger.log(
                    '🔇 Silencio detectado, forzando procesamiento',
                  );
                }, 100);

                if (mulawBufferCounter == undefined) {
                  // Se ha enviado al deepgram y espera respuesta
                }
              } else {
                mulawBufferCounter += mulawBuffer;
                this.logger.log(`🎤 Voz detectada (RMS=${rms.toFixed(2)})`);
              }

              /*
              if (mulawBuffer.length < 20) {
                silenceCounter++;
                if (silenceCounter >= SILENCE_THRESHOLD) {
                  this.logger.log(
                    '🔇 Silencio detectado, forzando procesamiento',
                  );
                  silenceCounter = 0;
                }
              } else {
                silenceCounter++;
              }
              */

              if (mulawBuffer.length > 0 && this.deepgram.isConnected) {
                // this.deepgram.sendAudioChunk(mulawBuffer);
              }
            } catch (err) {
              this.logger.error('❌ Error procesando audio', err);
            }
            break;

          case 'stop':
            this.logger.log(`⏹️ Stream detenido (sid=${streamSid})`);
            this.deepgram.stop();
            isProcessing = false;
            break;
        }
      } catch (err) {
        this.logger.error('❌ Error general', err);
      }
    });

    client.on('close', () => {
      this.logger.log('❌ Twilio desconectado');
      this.deepgram.stop();
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Cliente desconectado');
    this.deepgram.stop();
    client.terminate();
  }

  resamplePCM16To16k(pcm8k: Int16Array): Int16Array {
    const factor = 2; // 8k → 16k
    const resampled = new Int16Array(pcm8k.length * factor);

    for (let i = 0; i < resampled.length; i++) {
      resampled[i] = pcm8k[Math.floor(i / factor)];
    }

    return resampled;
  }
}
