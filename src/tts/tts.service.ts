// tts.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'querystring';
import * as wav from 'node-wav';

@Injectable()
export class TtsService {
  private coquiServerUrl =
    process.env.COQUI_SERVER_URL || 'http://localhost:5002';
  private modelName =
    process.env.COQUI_MODEL_NAME || 'tts_models/es/css10/vits';

  /*
    curl -X POST "https://test.sustentiatec.com:5002/api/tts" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "text=Hola+SOY+JHAN+ROBERT&model_name=tts_models%2Fes%2Fcss10%2Fvits" \
    --output prueba_form.wav
  */

  async synthesizeToBuffer(text: string): Promise<Buffer> {
    try {
      // Limpiar y preparar el texto para TTS
      const cleanText = this.cleanTextForTts(text);

      // Usar endpoint /api/tts con form-urlencoded (que sabemos funciona)
      const formData = qs.stringify({
        text: cleanText,
        model_name: this.modelName,
        language_id: 'es',
      });

      const response = await axios.post(
        `${this.coquiServerUrl}/api/tts`,
        formData,
        {
          responseType: 'arraybuffer',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000, // 30 segundos timeout
        },
      );

      // Coqui TTS devuelve audio en formato WAV, necesitamos extraer el PCM
      return this.extractPcmFromWav(Buffer.from(response.data));
    } catch (error) {
      console.error('Coqui TTS error:', error.message);
      throw new Error(`TTS synthesis failed: ${error.message}`);
    }
  }

  private cleanTextForTts(text: string): string {
    return text
      .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.,!?;:()\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 500); // Limitar longitud para seguridad
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.coquiServerUrl}/api/health`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      console.log('TTS Server health check failed:', error.message);
      return false;
    }
  }

  /**
   * Extrae el audio PCM del WAV devuelto por Coqui TTS
   * Coqui devuelve WAV, pero el VoiceGateway espera PCM raw
   */
  private extractPcmFromWav(wavBuffer: Buffer): Buffer {
    const result = wav.decode(wavBuffer);
    // result.sampleRate -> frecuencia original (ej. 22050)
    // result.channelData -> array de Float32Array por canal
    // Mezclar canales a mono si hay más de uno
    let monoFloat: Float32Array;
    if (result.channelData.length > 1) {
      const length = result.channelData[0].length;
      monoFloat = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const channel of result.channelData) {
          sum += channel[i];
        }
        monoFloat[i] = sum / result.channelData.length;
      }
    } else {
      monoFloat = result.channelData[0];
    }
    // Convertir float32 [-1,1] a Int16
    const int16 = new Int16Array(monoFloat.length);
    for (let i = 0; i < monoFloat.length; i++) {
      const s = Math.max(-1, Math.min(1, monoFloat[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // Si la frecuencia no es 16000 Hz, aquí deberías hacer resample (opcional)
    return Buffer.from(int16.buffer);
  }
}
