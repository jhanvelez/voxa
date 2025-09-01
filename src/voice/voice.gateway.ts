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

    client.on('message', async (message: Buffer) => {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch {
        this.logger.warn('⚠️ Invalid JSON message');
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
              this.logger.log(`📝 Transcripción: ${transcript}`);

              try {
                const reply = await this.llm.ask(transcript);
                this.logger.log(`🤖 Respuesta LLM: ${reply}`);

                // Sintetizar audio
                const mulawBuffer = await this.tts.synthesizeToMuLaw8k(reply);

                // Enviar audio en chunks
                const chunkSize = 160;
                for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
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
                }

                // Señal de fin de media
                client.send(
                  JSON.stringify({
                    event: 'mark',
                    streamSid,
                    mark: { name: 'endOfAudio' },
                  }),
                );
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

      /*
      try {
        if (data.event === 'start') {
          this.deepgram.stop();
          streamSid = data.start.streamSid;
          this.logger.log(`Stream started (sid=${streamSid})`);

          this.deepgram.connect(async (transcript) => {
            this.logger.log(`📝 Transcript: ${transcript}`);

            try {
              const reply = await this.llm.ask(transcript);
              this.logger.log(`🤖 LLM reply: ${reply}`);

              // TTS (PCM16 16kHz)
              const mulawBuffer = await this.tts.synthesizeToMuLaw8k(reply);

              const chunkSize = 160;
              for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
                const chunk = mulawBuffer.subarray(i, i + chunkSize);
                client.send(
                  JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: { payload: chunk.toString('base64') },
                  }),
                );
              }
            } catch (err) {
              this.logger.error('❌ Error in LLM/TTS pipeline', err);
            }
          });
        } else if (data.event === 'media') {
          if (!data.media?.payload) {
            this.logger.warn('⚠️ Media event sin payload válido');
            return;
          }

          let mulawBuffer: Buffer;
          try {
            mulawBuffer = Buffer.from(data.media.payload, 'base64');
          } catch (err) {
            this.logger.error('❌ Payload base64 inválido', err);
            return;
          }

          if (!mulawBuffer || mulawBuffer.length === 0) {
            this.logger.warn('⚠️ mulawBuffer vacío');
            return;
          }

          if (this.deepgram.isConnected) {
            this.deepgram.sendAudioChunk(mulawBuffer);
          } else {
            this.logger.warn('⚠️ Deepgram no conectado, audio no enviado');
          }
        } else if (data.event === 'stop') {
          this.logger.log(`Stream stopped (sid=${streamSid})`);
          this.deepgram.stop();
          client.close();
        }
      } catch (err) {
        this.logger.error('❌ Error data', err);
      }
      */
    });

    client.on('close', () => {
      this.logger.log('❌ Twilio disconnected');
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
