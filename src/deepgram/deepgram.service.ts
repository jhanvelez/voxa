import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import VAD from 'webrtcvad';

@Injectable()
export class DeepgramService {
  private ws?: WebSocket;
  private apiKey = process.env.DEEPGRAM_API_KEY;
  public isConnected = false;
  private audioBuffer: Buffer[] = [];
  private bufferSize = 0;
  private readonly MAX_BUFFER_SIZE = 3200;
  private processingTimeout?: NodeJS.Timeout;
  private vad = new VAD(8000, 3);

  connect(onTranscript: (text: string) => void) {
    console.log('🔗 Conectando a Deepgram...');

    const url = `wss://api.deepgram.com/v1/listen?model=phonecall&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&language=es&endpointing=300&utterance_end_ms=1000`;

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.audioBuffer = [];
      this.bufferSize = 0;
      console.log('✅ Deepgram conectado');
    });

    this.ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log('📨 Deepgram response:', JSON.stringify(data, null, 2));

        if (data.type === 'Results') {
          const transcript = data?.channel?.alternatives?.[0]?.transcript;
          const isFinal = data?.is_final;

          if (transcript && transcript.trim().length > 0) {
            console.log(
              `🔊 Transcripción: "${transcript}" (final: ${isFinal})`,
            );

            if (isFinal) {
              onTranscript(transcript);
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
