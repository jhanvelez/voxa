import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import VAD from 'webrtcvad';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;
  public isConnected = false;
  private bufferSize = 0;

  private vad = new VAD(8000, 3);
  private partialTranscript = '';
  private lastFinalTranscript = '';
  private audioBuffer: Buffer[] = [];
  private readonly MAX_BUFFER_SIZE = 3200;
  private transcriptCallback?: (text: string) => void;

  connect(onTranscript: (text: string) => void) {
    console.log('🔗 Conectando a Deepgram...');
    this.transcriptCallback = onTranscript;

    // Mejor configuración para audio telefónico
    const url = `wss://api.deepgram.com/v1/listen?model=phonecall&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&language=es&endpointing=300&utterance_end_ms=1000`;

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.partialTranscript = '';
      this.lastFinalTranscript = '';
      console.log('✅ Deepgram conectado');
    });

    this.ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        if (data.type === 'Results') {
          const transcript = data?.channel?.alternatives?.[0]?.transcript;
          const isFinal = data?.is_final;
          const speechFinal = data?.speech_final;

          if (transcript && transcript.trim().length > 0) {
            console.log(
              `🔊 Deepgram: ${transcript} (final: ${isFinal}, speech_final: ${speechFinal})`,
            );

            if (isFinal) {
              // Transcripción final y completa
              this.lastFinalTranscript = transcript;
              if (this.transcriptCallback) {
                this.transcriptCallback(transcript);
              }
              this.partialTranscript = '';
            } else if (speechFinal) {
              // Speech final pero no necessarily is_final
              this.partialTranscript = transcript;
            } else {
              // Transcripción parcial - acumular pero no procesar aún
              this.partialTranscript = transcript;
            }
          }
        }
      } catch (e) {
        console.log('❌ Error parsing Deepgram message:', e);
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      console.log('🔌 Deepgram desconectado');
    });

    this.ws.on('error', (err) => {
      console.error('❌ Error de Deepgram:', err);
      this.isConnected = false;
    });
  }

  sendAudioChunk(chunk: Buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Verificar si hay voz
    const hasVoice = this.vad.process(chunk);

    if (hasVoice) {
      this.audioBuffer.push(chunk);
      this.bufferSize += chunk.length;

      if (this.bufferSize >= this.MAX_BUFFER_SIZE) this.flushBuffer();
    } else {
      this.flushBuffer(true);
    }
  }

  private flushBuffer(force = false) {
    if (this.audioBuffer.length === 0) return;

    if (this.bufferSize >= this.MAX_BUFFER_SIZE || force) {
      const combinedBuffer = Buffer.concat(this.audioBuffer);

      try {
        this.ws!.send(combinedBuffer);
        console.log(`📤 Enviado buffer: ${combinedBuffer.length} bytes`);
      } catch (e) {
        console.error('❌ Error enviando audio a Deepgram:', e);
      }

      this.audioBuffer = [];
      this.bufferSize = 0;
    }
  }

  stop() {
    try {
      // Enviar cualquier audio pendiente
      this.flushBuffer();

      if (this.ws) {
        this.ws.close();
        this.isConnected = false;
      }
    } catch (e) {
      console.log('❌ Error cerrando conexión Deepgram:', e);
    }
  }
}
