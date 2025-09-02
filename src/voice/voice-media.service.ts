import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

@Injectable()
export class VoiceMediaService {
  private readonly logger = new Logger(VoiceMediaService.name);
  private streams: Record<string, NodeJS.WritableStream> = {};

  private outputDir = join(process.cwd(), 'recordings');

  constructor() {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  startRecording(streamSid: string) {
    const filename = join(this.outputDir, `${streamSid}.wav`);
    this.logger.log(`🎙️ Iniciando grabación: ${filename}`);

    // Crear stream y escribir encabezado WAV vacío (se completará al final)
    const ws = createWriteStream(filename);
    const header = this.generateWavHeader(0); // placeholder
    ws.write(header);

    this.streams[streamSid] = ws;
  }

  handlePacket(base64Payload: string, streamSid: string) {
    const buffer = Buffer.from(base64Payload, 'base64');

    if (!this.streams[streamSid]) {
      this.startRecording(streamSid);
    }

    this.streams[streamSid].write(buffer);
  }

  stopRecording(streamSid: string) {
    const ws = this.streams[streamSid];
    if (ws) {
      this.logger.log(`🛑 Cerrando grabación de ${streamSid}`);
      ws.end();
      delete this.streams[streamSid];
    }
  }

  private generateWavHeader(dataLength: number): Buffer {
    const sampleRate = 8000;
    const channels = 1;
    const bytesPerSample = 1; // µ-law = 8 bits

    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0); // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
    buffer.write('WAVE', 8); // Format
    buffer.write('fmt ', 12); // Subchunk1ID
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(7, 20); // AudioFormat (7 = µ-law)
    buffer.writeUInt16LE(channels, 22); // NumChannels
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(byteRate, 28); // ByteRate
    buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
    buffer.writeUInt16LE(8, 34); // BitsPerSample
    buffer.write('data', 36); // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

    return buffer;
  }
}
