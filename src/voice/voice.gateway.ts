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
import { encode, decode } from 'mulaw-js';
import * as prism from 'prism-media';

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
    this.logger.log('🔌 Twilio connected to Voice Gateway');

    let streamSid: string | null = null;

    client.on('message', async (message: Buffer) => {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch {
        this.logger.warn('⚠️ Invalid JSON message');
        return;
      }
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
              const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

              console.log(pcm16Buffer);

              if (!pcm16Buffer || pcm16Buffer.length === 0) {
                this.logger.error('❌ TTS devolvió un buffer vacío');
                return;
              }

              // Convert PCM16 → mulaw 8kHz
              let mulawBuffer: Buffer;
              try {
                const samples = new Int16Array(pcm16Buffer.buffer);
                const mulawSamples = encode(samples);
                mulawBuffer = Buffer.from(mulawSamples);
              } catch (err) {
                this.logger.error('❌ Error convirtiendo PCM16 → µLaw', err);
                return;
              }

              // Send back to Twilio
              if (mulawBuffer?.length) {
                const msg = JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: { payload: mulawBuffer.toString('base64') },
                });
                client.send(msg);
              } else {
                this.logger.warn('⚠️ mulawBuffer vacío, no se envía audio');
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

          let pcm16Samples: Int16Array;
          try {
            const mulawSamples = new Uint8Array(mulawBuffer);
            pcm16Samples = decode(mulawSamples);
          } catch (err) {
            this.logger.error('❌ Error al decodificar µLaw → PCM16', err);
            return;
          }

          if (!pcm16Samples || pcm16Samples.length === 0) {
            this.logger.warn('⚠️ pcm16Samples vacío');
            return;
          }

          const resampledSamples = this.resamplePCM16To16k(pcm16Samples);

          const minSample = Math.min(...resampledSamples);
          const maxSample = Math.max(...resampledSamples);
          this.logger.debug(
            `PCM16 sample range: min=${minSample}, max=${maxSample}`,
          );
          const pcm16Buffer = Buffer.from(resampledSamples.buffer);

          const mulawBuffer2 = Buffer.from(data.media.payload, 'base64');
          const pcm16Buffer2 = await this.convertMulaw8kToPcm16(mulawBuffer2);

          if (this.deepgram.isConnected) {
            this.deepgram.sendAudioChunk(pcm16Buffer2);
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

      try {
        /*
        if (data.event === 'start') {
          streamSid = data.start.streamSid;
          this.logger.log(`Stream started (sid=${streamSid})`);

          console.log(streamSid);

          this.deepgram.connect(async (transcript) => {
            this.logger.log(`📝 Transcript: ${transcript}`);

            try {
              const reply = await this.llm.ask(transcript);
              this.logger.log(`🤖 LLM reply: ${reply}`);

              // TTS (PCM16 16kHz)
              const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

              if (!pcm16Buffer || pcm16Buffer.length === 0) {
                this.logger.error('❌ TTS devolvió un buffer vacío');
                return;
              }

              // Convert PCM16 → mulaw 8kHz
              let mulawBuffer: Buffer;
              try {
                const samples = new Int16Array(pcm16Buffer.buffer);
                const mulawSamples = encode(samples);
                mulawBuffer = Buffer.from(mulawSamples);
              } catch (err) {
                this.logger.error('❌ Error convirtiendo PCM16 → µLaw', err);
                return;
              }

              // Send back to Twilio
              if (mulawBuffer?.length) {
                const msg = JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: { payload: mulawBuffer.toString('base64') },
                });
                client.send(msg);
              } else {
                this.logger.warn('⚠️ mulawBuffer vacío, no se envía audio');
              }
            } catch (err) {
              this.logger.error('❌ Error in LLM/TTS pipeline', err);
            }
          });
        } else if (data.event === 'media') {

        } else if (data.event === 'stop') {
          this.logger.log(`Stream stopped (sid=${streamSid})`);
          this.deepgram.stop();
          client.close();
        }
        */
      } catch (err) {
        this.logger.error('❌ Error handling WS message', err);
      }
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

    private async convertPcm16ToMulaw8k(pcmBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-f', 's16le',
          '-ar', '16000',
          '-ac', '1',
          '-i', 'pipe:0',
          '-f', 'mulaw',
          '-ar', '8000',
          '-ac', '1',
          'pipe:1',
        ],
      });

      const outputChunks: Buffer[] = [];
      ffmpeg.on('data', (chunk: Buffer) => outputChunks.push(chunk));
      ffmpeg.on('end', () => resolve(Buffer.concat(outputChunks)));
      ffmpeg.on('error', (err) => reject(err));

      ffmpeg.write(pcmBuffer);
      ffmpeg.end();
    });
  }

  private async convertMulaw8kToPcm16(mulawBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-f', 'mulaw',
          '-ar', '8000',
          '-ac', '1',
          '-i', 'pipe:0',
          '-f', 's16le',
          '-ar', '16000',
          '-ac', '1',
          'pipe:1',
        ],
      });

      const outputChunks: Buffer[] = [];
      ffmpeg.on('data', (chunk: Buffer) => outputChunks.push(chunk));
      ffmpeg.on('end', () => resolve(Buffer.concat(outputChunks)));
      ffmpeg.on('error', (err) => reject(err));

      ffmpeg.write(mulawBuffer);
      ffmpeg.end();
    });
  }
}
