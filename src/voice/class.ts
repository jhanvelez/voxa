import * as fs from 'fs';
import * as path from 'path';

export class WavFileWriter {
  private fd: number | null = null;
  private filePath: string = '';
  private totalBytes: number = 0;

  constructor(
    private sampleRate = 8000,
    private channels = 1,
  ) {}

  start(filename: string) {
    this.filePath = path.resolve(__dirname, '..', 'recordings', filename);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.fd = fs.openSync(this.filePath, 'w');

    // Escribir cabecera WAV placeholder (44 bytes)
    const header = Buffer.alloc(44);
    fs.writeSync(this.fd, header);
  }

  write(pcmChunk: Buffer) {
    if (!this.fd) return;
    fs.writeSync(this.fd, pcmChunk);
    this.totalBytes += pcmChunk.length;
  }

  stop() {
    if (!this.fd) return;

    // Actualizar cabecera WAV con los valores finales
    const header = this.createWavHeader(this.totalBytes);
    fs.writeSync(this.fd, header, 0, header.length, 0);
    fs.closeSync(this.fd);
    this.fd = null;

    console.log(`✅ Audio guardado en ${this.filePath}`);
  }

  private createWavHeader(dataLength: number): Buffer {
    const header = Buffer.alloc(44);

    const byteRate = this.sampleRate * this.channels * 2;
    const blockAlign = this.channels * 2;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34); // Bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }
}
