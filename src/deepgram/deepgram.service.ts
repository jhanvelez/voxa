import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;
  public isConnected = false;

  connect(onTranscript: (text: string) => void) {
    console.log('Intento de conexion');

    const url = `wss://api.deepgram.com/v1/listen?model=phonecall&encoding=mulaw&sample_rate=8000&channels=2`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      console.log('Deepgram WS connected');
    });

    this.ws.on('message', (msg) => {
      console.log('Text: ', msg.toString());

      try {
        const data = JSON.parse(msg.toString());
        const transcript = data?.channel?.alternatives?.[0]?.transcript;
        // const isFinal = data?.is_final; <-- Verificar sei se usa cuando finaliza el call
        if (transcript && transcript.trim().length) {
          // puedes filtrar por is_final si quieres solo finales
          onTranscript(transcript);
        }
      } catch (e) {
        // no-JSON messages posiblemente (ignore)
        console.log('connect error: ', e);
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      console.log('Deepgram WS closed');
    });
    this.ws.on('error', (err) => console.error('Deepgram error', err));
  }

  sendAudioChunk(chunk: Buffer) {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(chunk);
  }

  stop() {
    try {
      this.ws?.close();
    } catch (e) {
      console.log('Stop error: ', e);
    }
  }
}
