import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TtsService } from './tts/tts.service';
import { LlmService } from './llm/llm.service';
import { DeepgramService } from './deepgram/deepgram.service';
import { VoiceGateway } from './voice/voice.gateway';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    VoiceGateway,
    DeepgramService,
    LlmService,
    TtsService,
  ],
})
export class AppModule {}
