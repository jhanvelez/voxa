import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;
  public isConnected = false;
  private partialTranscript = '';
  private lastFinalTranscript = '';
  private transcriptCallback?: (text: string) => void;

  connect(onTranscript: (text: string) => void) {
    console.log('🔗 Conectando a Deepgram...');
    this.transcriptCallback = onTranscript;

    // Mejor configuración para audio telefónico
    const url = `wss://api.deepgram.com/v1/listen?model=phonecall&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&endpointing=500&punctuate=true`;
    // Added: interim_results, endpointing, punctuate

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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(chunk);
    } catch (e) {
      console.error('❌ Error enviando audio a Deepgram:', e);
    }
  }

  stop() {
    try {
      // Si hay transcripción parcial pendiente, procesarla
      if (
        this.partialTranscript &&
        this.partialTranscript !== this.lastFinalTranscript
      ) {
        console.log(
          `📝 Procesando transcripción pendiente: ${this.partialTranscript}`,
        );
        if (this.transcriptCallback) {
          this.transcriptCallback(this.partialTranscript);
        }
      }

      if (this.ws) {
        this.ws.close();
        this.isConnected = false;
        this.partialTranscript = '';
      }
    } catch (e) {
      console.log('❌ Error cerrando conexión Deepgram:', e);
    }
  }

  // Nuevo método para forzar el procesamiento de transcripción pendiente
  flushTranscript() {
    if (
      this.partialTranscript &&
      this.partialTranscript !== this.lastFinalTranscript
    ) {
      if (this.transcriptCallback) {
        this.transcriptCallback(this.partialTranscript);
      }
      this.lastFinalTranscript = this.partialTranscript;
    }
  }
}
