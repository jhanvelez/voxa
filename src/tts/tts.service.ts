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

  async synthesizeToMuLaw8k(text: string): Promise<Buffer> {
    try {
      const formData = qs.stringify({
        text,
        model_name: this.modelName,
        language_id: 'es',
      });

      const response = await axios.post(
        `${this.coquiServerUrl}/api/tts`,
        formData,
        {
          responseType: 'arraybuffer',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        },
      );

      const wavBuffer = Buffer.from(response.data);
      const { pcm16, sampleRate } = this.extractPcmAndRate(wavBuffer);

      // Resample a 8000 Hz
      const resampled = this.resamplePCM16(pcm16, sampleRate, 8000);

      // Convertir a µLaw 8kHz
      const mulawBuffer = Buffer.from(encode(resampled));

      return mulawBuffer;
    } catch (err) {
      console.error('TTS synthesis error:', err.message);
      throw err;
    }
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
