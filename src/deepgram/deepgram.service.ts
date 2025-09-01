import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;
  public isConnected = false;
  private partialTranscript = '';

  connect(onTranscript: (text: string) => void) {
    console.log('🔗 Conectando a Deepgram...');

    // Configuración CORRECTA para Twilio
    const url = `wss://api.deepgram.com/v1/listen?model=phonecall&encoding=mulaw&sample_rate=8000&channels=1`;
    // Cambiado a channels=1 (Twilio envía mono)

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.partialTranscript = '';
      console.log('✅ Deepgram conectado');
    });

    this.ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        // Solo procesar si es una transcripción
        if (data.type === 'Results') {
          const transcript = data?.channel?.alternatives?.[0]?.transcript;
          const isFinal = data?.is_final;

          if (transcript && transcript.trim().length > 0) {
            if (isFinal) {
              // Transcripción final - enviar completa
              onTranscript(transcript);
              this.partialTranscript = '';
            } else {
              // Transcripción parcial - acumular
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
      console.warn('⚠️ Deepgram no está conectado, no se puede enviar audio');
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
      if (this.ws) {
        this.ws.close();
        this.isConnected = false;
        this.partialTranscript = '';
      }
    } catch (e) {
      console.log('❌ Error cerrando conexión Deepgram:', e);
    }
  }
}
