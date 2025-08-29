import { Injectable } from '@nestjs/common';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

@Injectable()
export class TtsService {
  private key = process.env.AZURE_SPEECH_KEY || '';
  private region = process.env.AZURE_SPEECH_REGION || '';

  private speechConfig() {
    const sc = sdk.SpeechConfig.fromSubscription(this.key, this.region);
    sc.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm;
    return sc;
  }

  async synthesizeToBuffer(text: string): Promise<Buffer> {
    const speechConfig = this.speechConfig();
    // Create a push stream to receive audio data
    const pushStream = sdk.AudioOutputStream.createPullStream();
    const audioConfig = sdk.AudioConfig.fromStreamOutput(pushStream);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    return new Promise((resolve, reject) => {
      // const chunks: Buffer[] = [];

      // listen to pushStream 'write' events is not straightforward; instead use speakTextAsync callback result.audioData
      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const audioData = result.audioData; // ArrayBuffer
            const buf = Buffer.from(audioData);
            synthesizer.close();
            resolve(buf);
          } else {
            synthesizer.close();
            reject(new Error('Synthesis failed: ' + result.errorDetails));
          }
        },
        (err) => {
          synthesizer.close();
          reject(err);
        },
      );
    });
  }
}
