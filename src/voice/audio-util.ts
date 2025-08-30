import Prism from 'prism-media';

/**
 * Convierte mu-law 8k -> PCM signed 16-bit little endian 16k
 * (Twilio envía ulaw @8k; Deepgram/Azure esperan PCM 16k/16bit)
 */
export function ulaw8ToPcm16Stream() {
  // prism-media puede convertir mu-law -> s16le y luego pipe a sox/resampler si se necesita
  const decoder = new Prism.opus.Decoder({
    frameSize: 960,
    channels: 1,
    rate: 48000,
  });
  // Not directly ulaw; use prism.Media to build pipeline
  // Instead we'll use Prism.FFmpeg to transcode if FFmpeg is installed.
  // But prism-media has "opus" decoder, not ulaw. Safer approach: use ffmpeg via spawn or prism.FFmpeg
  // We'll provide a helper that uses ffmpeg CLI via prism.FFmpeg when binary exists.
  return new Prism.FFmpeg({
    args: [
      '-f',
      'mulaw',
      '-ar',
      '8000',
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'pipe:1',
    ],
  });
}

/**
 * Convierte PCM16 16k -> mu-law 8k (para Twilio playback)
 */
export function pcm16ToUlaw8Stream() {
  return new Prism.FFmpeg({
    args: [
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-f',
      'mulaw',
      '-ar',
      '8000',
      '-ac',
      '1',
      'pipe:1',
    ],
  });
}
