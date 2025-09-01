import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { DeepgramService } from '../deepgram/deepgram.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import * as prism from 'prism-media';

@WebSocketGateway({ path: '/voice-stream' }) // 🔑 Twilio conectará aquí
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

    // Configurar escucha de mensajes entrantes
    client.on('message', async (message: Buffer) => {
      this.logger.log('WS raw message: ' + message.toString().slice(0, 300));
      try {
        const data = JSON.parse(message.toString());

        if (data.event === 'media') {
          // 🎙️ Audio entrante en mu-law 8kHz → convertir a PCM16 16kHz
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');
          const pcm16Buffer = await this.convertMulaw8kToPcm16(mulawBuffer);

          this.deepgram.sendAudioChunk(pcm16Buffer);
        } else if (data.event === 'start') {
          this.logger.log('Stream started');
          this.deepgram.connect(async (transcript) => {
            this.logger.log('Deepgram transcript:', transcript);

            try {
              const reply = await this.llm.ask(transcript);
              this.logger.log('LLM reply:', reply);

              // sintetizar TTS con Coqui (PCM16 16kHz)
              const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

              // Convertir PCM16 → mu-law 8kHz
              const mulawBuffer = await this.convertPcm16ToMulaw8k(pcm16Buffer);

              const payload = mulawBuffer.toString('base64');
              const msg = JSON.stringify({
                event: 'media',
                media: { payload },
              });

              client.send(msg);
            } catch (err) {
              this.logger.error('Error manejando transcript -> LLM/TTS', err);
            }
          });
        } else if (data.event === 'stop') {
          this.logger.log('Stream stopped');
          this.deepgram.stop();
        }
      } catch (e) {
        this.logger.error('Invalid WS message', e);
      }
    });

    client.on('close', () => {
      this.logger.log('❌ Twilio disconnected');
      this.deepgram.stop();
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Cliente desconectado:', client);
  }

  // --- Conversión PCM16 <-> mu-law ---
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
