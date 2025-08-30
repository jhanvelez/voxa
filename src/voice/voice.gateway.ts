// voice.gateway.ts - Versión corregida
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { DeepgramService } from '../deepgram/deepgram.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import * as prism from 'prism-media';

@Injectable()
export class VoiceGateway implements OnModuleInit {
  private readonly logger = new Logger(VoiceGateway.name);
  private wss: WebSocketServer;
  private port = parseInt(process.env.TWILIO_WS_PORT || '8080', 10);

  constructor(
    private deepgram: DeepgramService,
    private llm: LlmService,
    private tts: TtsService,
  ) {}

  onModuleInit() {
    this.wss = new WebSocket.Server({ port: this.port });
    this.logger.log(
      `Voice Gateway WebSocket listening on ws://0.0.0.0:${this.port}`,
    );
    this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));
  }

  async handleConnection(ws: WebSocket) {
    this.logger.log('Twilio connected to Voice Gateway');

    this.deepgram.connect(async (transcript) => {
      this.logger.log('Deepgram transcript:', transcript);

      try {
        const reply = await this.llm.ask(transcript);
        this.logger.log('LLM reply:', reply);

        // sintetizar TTS con Coqui (PCM 16khz)
        const pcm16Buffer = await this.tts.synthesizeToBuffer(reply);

        // Convertir PCM16 16k -> mulaw 8k para Twilio
        const mulawBuffer = await this.convertPcm16ToMulaw8k(pcm16Buffer);

        const payload = mulawBuffer.toString('base64');
        const msg = JSON.stringify({
          event: 'media',
          media: { payload },
        });

        // enviar audio de vuelta a Twilio
        ws.send(msg);
      } catch (err) {
        this.logger.error('Error handling transcript -> LLM/TTS', err);
      }
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.event === 'media') {
          // Twilio envía payload base64 mu-law 8k
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');

          // Convertir mu-law 8k -> PCM16 16k para Deepgram
          const pcm16Buffer = this.convertMulaw8kToPcm16(mulawBuffer);

          // enviar a Deepgram
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

  /**
   * Convierte PCM16 16kHz a mu-law 8kHz para Twilio
   */
  private async convertPcm16ToMulaw8k(pcmBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-f',
          's16le', // Formato de entrada: PCM signed 16-bit little-endian
          '-ar',
          '16000', // Sample rate de entrada: 16kHz
          '-ac',
          '1', // Canales de entrada: mono
          '-i',
          'pipe:0', // Entrada desde stdin
          '-f',
          'mulaw', // Formato de salida: mu-law
          '-ar',
          '8000', // Sample rate de salida: 8kHz
          '-ac',
          '1', // Canales de salida: mono
          'pipe:1', // Salida a stdout
        ],
      });

      const outputChunks: Buffer[] = [];

      // prism-media usa streams diferentes
      ffmpeg.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      ffmpeg.on('end', () => {
        resolve(Buffer.concat(outputChunks));
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });

      // Escribir datos PCM al FFmpeg
      ffmpeg.write(pcmBuffer);
      ffmpeg.end();
    });
  }

  /**
   * Convierte mu-law 8kHz a PCM16 16kHz para Deepgram
   */
  private convertMulaw8kToPcm16(mulawBuffer: Buffer): Buffer {
    // Para esta conversión podemos hacerlo en memoria si es simple
    // o usar FFmpeg para conversiones más complejas

    // Implementación simple para mu-law -> PCM (puedes mejorarla)
    try {
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-f',
          'mulaw', // Formato de entrada: mu-law
          '-ar',
          '8000', // Sample rate de entrada: 8kHz
          '-ac',
          '1', // Canales de entrada: mono
          '-i',
          'pipe:0', // Entrada desde stdin
          '-f',
          's16le', // Formato de salida: PCM signed 16-bit little-endian
          '-ar',
          '16000', // Sample rate de salida: 16kHz
          '-ac',
          '1', // Canales de salida: mono
          'pipe:1', // Salida a stdout
        ],
      });

      const outputChunks: Buffer[] = [];

      ffmpeg.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      ffmpeg.on('end', () => {
        return Buffer.concat(outputChunks);
      });

      ffmpeg.on('error', (error) => {
        this.logger.error('FFmpeg conversion error:', error);
        return mulawBuffer; // Fallback
      });

      ffmpeg.write(mulawBuffer);
      ffmpeg.end();
    } catch (error) {
      this.logger.error('Error in audio conversion:', error);
      return mulawBuffer; // Fallback to original buffer
    }
  }

  /**
   * Método alternativo simple para conversión básica
   * (Solo para pruebas, implementar proper audio conversion luego)
   */
  private simpleMulawToPcmConversion(mulawBuffer: Buffer): Buffer {
    // Esta es una conversión muy básica - necesitarás implementar
    // un algoritmo proper de mu-law to PCM para producción
    return mulawBuffer; // Placeholder
  }
}
