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

  private readonly MULAW_DECODE_TABLE: Int16Array = (() => {
    const table = new Int16Array(256);
    const BIAS = 0x84; // 132
    for (let i = 0; i < 256; i++) {
      let mu = ~i & 0xff;
      let sign = mu & 0x80;
      let exponent = (mu >> 4) & 0x07;
      let mantissa = mu & 0x0f;
      let sample = ((mantissa << 4) + BIAS) << (exponent + 3);
      if (sign !== 0) sample = -sample;
      table[i] = sample;
    }
    return table;
  })();

  private muLawDecode(muLawByte: number): number {
    return this.MULAW_DECODE_TABLE[muLawByte & 0xff];
  }

  handleConnection(client: WebSocket) {
    this.logger.log('🔌 Twilio conectado');
    let streamSid: string | null = null;
    let isProcessing = false;

    // const SILENCE_THRESHOLD = 200;
    // const SILENCE_FRAMES = 5;
    // let mulawBufferCounter: Buffer | undefined = undefined;
    // let silenceCounter = 0;

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

              /*
              const first10 = Array.from(mulawBuffer.slice(0, 10)).join(', ');
              this.logger.debug(`Primeros 10 bytes µ-law: ${first10}`);

              this.logger.log(
                `📥 Audio recibido: ${mulawBuffer.length} bytes µ-law`,
              );
              */

              if (mulawBuffer.length > 0 && this.deepgram.isConnected) {
                // Envía el audio µ-law directamente sin convertir
                this.deepgram.sendAudioChunk(mulawBuffer);
                /*
                this.logger.log(
                  `📤 Enviado a Deepgram ${mulawBuffer.length} bytes (µ-law)`,
                );
                */
              }

              /*
              const pcm16 = new Int16Array(mulawBuffer.length);

              for (let i = 0; i < mulawBuffer.length; i++) {
                pcm16[i] = this.muLawDecode(mulawBuffer[i]);
              }

              const pcmBuffer = Buffer.from(pcm16.buffer);

              this.logger.debug(
                `Primeros 10 samples PCM16: ${pcm16.slice(0, 10).join(', ')}`,
              );

              this.logger.log(
                `📥 Audio recibido: ${mulawBuffer.length} bytes µ-law → ${pcmBuffer.length} bytes PCM`,
              );

              if (pcmBuffer.length > 0 && this.deepgram.isConnected) {
                this.deepgram.sendAudioChunk(pcmBuffer);
                this.logger.log(
                  `📤 Enviado a Deepgram ${pcmBuffer.length} bytes`,
                );
              }
              */
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
