import { Injectable } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;

  connect(onTranscript: (text: string) => void) {
    const url = `wss://api.deepgram.com/v1/listen?model=general&encoding=linear16&sample_rate=16000&channels=1`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log('Deepgram WS connected');
    });

    this.ws.on('message', (msg) => {
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

    this.ws.on('close', () => console.log('Deepgram WS closed'));
    this.ws.on('error', (err) => console.error('Deepgram error', err));
  }

  sendAudioChunk(chunk: Buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Deepgram espera raw binary audio for streaming
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
