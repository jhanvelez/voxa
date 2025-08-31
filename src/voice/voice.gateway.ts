import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DeepgramService } from '../deepgram/deepgram.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import * as prism from 'prism-media';

@Injectable()
export class VoiceGateway {
  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private deepgram: DeepgramService,
    private llm: LlmService,
    private tts: TtsService,
  ) {}

  async handleConnection(ws: WebSocket) {
    this.logger.log('Twilio connected to Voice Gateway');

    this.deepgram.connect(async (transcript) => {
      this.logger.log('Deepgram transcript:', transcript);

      try {
        const reply = await this.llm.ask(transcript);
        this.logger.log('LLM reply:', reply);

        // sintetizar TTS con Coqui (PCM 16kHz)
        const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

        // Convertir PCM16 → mu-law 8kHz para Twilio
        const mulawBuffer = await this.convertPcm16ToMulaw8k(pcm16Buffer);

        const payload = mulawBuffer.toString('base64');
        const msg = JSON.stringify({
          event: 'media',
          media: { payload },
        });

        ws.send(msg);
      } catch (err) {
        this.logger.error('Error handling transcript -> LLM/TTS', err);
      }
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.event === 'media') {
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');

          // Convertir mu-law → PCM16 16kHz
          const pcm16Buffer = await this.convertMulaw8kToPcm16(mulawBuffer);

          this.deepgram.sendAudioChunk(pcm16Buffer);
        } else if (data.event === 'start') {
          this.logger.log('Stream started');
        } else if (data.event === 'stop') {
          this.logger.log('Stream stopped');
          this.deepgram.stop();
        }
      } catch (e) {
        this.logger.error('Invalid WS message', e);
      }
    });

    ws.on('close', () => {
      this.logger.log('Twilio disconnected');
      this.deepgram.stop();
    });
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
