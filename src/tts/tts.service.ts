// tts.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'querystring';
import * as wav from 'node-wav';
import { encode } from 'mulaw-js';

@Injectable()
export class TtsService {
  private coquiServerUrl =
    process.env.COQUI_SERVER_URL || 'http://localhost:5002';
  private modelName =
    process.env.COQUI_MODEL_NAME || 'tts_models/es/css10/vits';
  private readonly MAX_TEXT_LENGTH = 200;

  async synthesizeToMuLaw8k(text: string): Promise<Buffer> {
    try {
      // Dividir texto en chunks si es muy largo
      if (text.length > this.MAX_TEXT_LENGTH) {
        return await this.synthesizeLongText(text);
      }
      return await this.synthesizeChunk(text);
    } catch (err) {
      console.error('TTS synthesis error:', err.message);
      throw err;
    }
  }

  private async synthesizeLongText(text: string): Promise<Buffer> {
    const chunks = this.splitTextIntoChunks(text);
    const audioChunks: Buffer[] = [];

    for (const chunk of chunks) {
      if (chunk.trim().length > 0) {
        const audio = await this.synthesizeChunk(chunk);
        audioChunks.push(audio);
        // Pequeña pausa entre chunks para no saturar
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return this.concatAudioBuffers(audioChunks);
  }

  private async synthesizeChunk(text: string): Promise<Buffer> {
    const formData = qs.stringify({
      text: text.substring(0, 500), // Limitar longitud por seguridad
      model_name: this.modelName,
      language_id: 'es',
    });

    const response = await axios.post(
      `${this.coquiServerUrl}/api/tts`,
      formData,
      {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000, // Reducir timeout
      },
    );

    const wavBuffer = Buffer.from(response.data);
    const { pcm16, sampleRate } = this.extractPcmAndRate(wavBuffer);
    const resampled = this.resamplePCM16(pcm16, sampleRate, 8000);
    return Buffer.from(encode(resampled));
  }

  private splitTextIntoChunks(text: string): string[] {
    // Dividir en frases naturales
    const sentenceRegex = /[^.!?]+[.!?]+/g;
    const sentences = text.match(sentenceRegex) || [text];

    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= this.MAX_TEXT_LENGTH) {
        currentChunk += sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sentence;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  private concatAudioBuffers(buffers: Buffer[]): Buffer {
    return Buffer.concat(buffers);
  }

  private extractPcmAndRate(wavBuffer: Buffer): {
    pcm16: Int16Array;
    sampleRate: number;
  } {
    const result = wav.decode(wavBuffer);
    let monoFloat: Float32Array;

    if (result.channelData.length > 1) {
      const length = result.channelData[0].length;
      monoFloat = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const ch of result.channelData) sum += ch[i];
        monoFloat[i] = sum / result.channelData.length;
      }
    } else {
      monoFloat = result.channelData[0];
    }

    const int16 = new Int16Array(monoFloat.length);
    for (let i = 0; i < monoFloat.length; i++) {
      const s = Math.max(-1, Math.min(1, monoFloat[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    return { pcm16: int16, sampleRate: result.sampleRate };
  }

  private resamplePCM16(
    input: Int16Array,
    inputRate: number,
    targetRate: number,
  ): Int16Array {
    const ratio = inputRate / targetRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.floor(i * ratio);
      output[i] = input[srcIndex];
    }

    return output;
  }
}
