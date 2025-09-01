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
import { encode, decode } from 'mulaw-js'; // 👈 reemplaza ffmpeg

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
          streamSid = data.start.streamSid;
          this.logger.log(`Stream started (sid=${streamSid})`);

          this.deepgram.connect(async (transcript) => {
            this.logger.log(`📝 Transcript: ${transcript}`);

            try {
              const reply = await this.llm.ask(transcript);
              this.logger.log(`🤖 LLM reply: ${reply}`);

              // TTS (PCM16 16kHz)
              const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

              // Convert PCM16 → mulaw 8kHz
              const samples = new Int16Array(pcm16Buffer.buffer);
              const mulawSamples = encode(samples);
              const mulawBuffer = Buffer.from(mulawSamples);

              // Send back to Twilio
              const msg = JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: mulawBuffer.toString('base64') },
              });
              client.send(msg);
            } catch (err) {
              this.logger.error('❌ Error in LLM/TTS pipeline', err);
            }
          });
        } else if (data.event === 'media') {
          if (!data.media?.payload) return;

          // μ-law 8kHz → PCM16 16kHz
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');
          const mulawSamples = new Uint8Array(mulawBuffer);
          const pcm16Samples = decode(mulawSamples);
          const pcm16Buffer = Buffer.from(pcm16Samples.buffer);

          this.deepgram.sendAudioChunk(pcm16Buffer);
        } else if (data.event === 'stop') {
          this.logger.log(`Stream stopped (sid=${streamSid})`);
          this.deepgram.stop();
          client.close();
        }
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
}
