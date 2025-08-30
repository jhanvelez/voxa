import { Injectable, OnModuleInit } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';

import { Readable } from 'stream';
import { DeepgramService } from '../deepgram/deepgram.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import Prism from 'prism-media';

@Injectable()
export class VoiceGateway implements OnModuleInit {
  private wss: WebSocketServer;
  private port = parseInt(process.env.TWILIO_WS_PORT || '8080', 10);

  constructor(
    private deepgram: DeepgramService,
    private llm: LlmService,
    private tts: TtsService,
  ) {}

  onModuleInit() {
    this.wss = new WebSocket.Server({ port: this.port });
    console.log(
      `Voice Gateway WebSocket listening on ws://0.0.0.0:${this.port}`,
    );

    this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));
  }

  async handleConnection(ws: WebSocket) {
    console.log('Twilio connected to Voice Gateway');

    // conectar Deepgram para este call
    this.deepgram.connect(async (transcript) => {
      console.log('Deepgram transcript:', transcript);
      // cuando Deepgram nos da texto, preguntamos al LLM
      try {
        const reply = await this.llm.ask(transcript);
        console.log('LLM reply:', reply);

        // sintetizar TTS con Azure (PCM 16khz s16le)
        const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

        // Convertir PCM16 16k -> mulaw 8k (Twilio requires mu-law 8k for playback)
        // usando FFmpeg through prism-media pipeline:
        const ffmpeg: any = new Prism.FFmpeg({
          args: [
            '-f',
            's16le',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-i',
            'pipe:0',
            '-f',
            'mulaw',
            '-ar',
            '8000',
            '-ac',
            '1',
            'pipe:1',
          ],
        });

        const inStream = Readable.from(pcm16Buffer);
        const outChunks: Buffer[] = [];

        ffmpeg.on('error', (e) => console.error('ffmpeg error', e));
        ffmpeg.on('close', () => {
          // cuando pipeline termine, tenemos audio ulaw 8k en outChunks
          const audioMulaw = Buffer.concat(outChunks);

          const payload = audioMulaw.toString('base64');
          const msg = JSON.stringify({
            event: 'media',
            media: { payload },
          });

          // enviar audio de vuelta a Twilio
          ws.send(msg);
        });

        ffmpeg.stdout.on('data', (c: Buffer) => outChunks.push(Buffer.from(c)));
        inStream.pipe(ffmpeg.stdin);
      } catch (err) {
        console.error('Error handling transcript -> LLM/TTS', err);
      }
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        // Eventos: 'start', 'media', 'stop'
        if (data.event === 'media') {
          // Twilio envía payload base64 mu-law 8k
          const b = Buffer.from(data.media.payload, 'base64');

          // convert mu-law 8k -> s16le 16k using ffmpeg pipeline to send to Deepgram
          const ffmpeg: any = new Prism.FFmpeg({
            args: [
              '-f',
              'mulaw',
              '-ar',
              '8000',
              '-ac',
              '1',
              '-i',
              'pipe:0',
              '-f',
              's16le',
              '-ar',
              '16000',
              '-ac',
              '1',
              'pipe:1',
            ],
          });

          const outChunks: Buffer[] = [];
          ffmpeg.stdout.on('data', (c: Buffer) =>
            outChunks.push(Buffer.from(c)),
          );
          ffmpeg.on('close', () => {
            const pcm16 = Buffer.concat(outChunks);
            // enviar a Deepgram (ya en PCM s16le 16k)
            this.deepgram.sendAudioChunk(pcm16);
          });

          ffmpeg.stdin.write(b);
          ffmpeg.stdin.end();
        } else if (data.event === 'start') {
          console.log('Stream started');
        } else if (data.event === 'stop') {
          console.log('Stream stopped');
          this.deepgram.stop();
        }
      } catch (e) {
        console.error('Invalid WS message', e);
      }
    });

    ws.on('close', () => {
      console.log('Twilio disconnected');
      this.deepgram.stop();
    });
  }
}
