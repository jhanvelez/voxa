// tts.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'querystring';

@Injectable()
export class TtsService {
  private coquiServerUrl =
    process.env.COQUI_SERVER_URL || 'http://localhost:5002';
  private modelName =
    process.env.COQUI_MODEL_NAME || 'tts_models/es/css10/vits';

  /*
    curl -X POST "http://3.16.21.105:5002/api/tts" \
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

  /**
   * Extrae el audio PCM del WAV devuelto por Coqui TTS
   * Coqui devuelve WAV, pero el VoiceGateway espera PCM raw
   */
  private extractPcmFromWav(wavBuffer: Buffer): Buffer {
    try {
      // Los archivos WAV tienen un header de 44 bytes
      // Extraemos solo los datos de audio PCM
      return wavBuffer.subarray(44);
    } catch (error) {
      console.warn(
        'Error extracting PCM from WAV, returning raw buffer',
        error,
      );
      return wavBuffer; // Fallback
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
}
