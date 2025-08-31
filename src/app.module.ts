import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TtsService } from './tts/tts.service';
import { LlmService } from './llm/llm.service';
import { DeepgramService } from './deepgram/deepgram.service';
import { VoiceGateway } from './voice/voice.gateway';
import { TwilioController } from './twilio/twilio.controller';
import { TwilioService } from './twilio/twilio.service';
import { VoiceController } from './voice/voice.controller';
import { TwinlController } from './twinl/twinl.controller';
import { TwimmlController } from './twimml/twimml.controller';
import { TwimlController } from './twiml/twiml.controller';

@Module({
  imports: [],
  controllers: [AppController, TwilioController, VoiceController, TwinlController, TwimmlController, TwimlController],
  providers: [
    AppService,
    VoiceGateway,
    DeepgramService,
    LlmService,
    TtsService,
    TwilioService,
  ],
})
export class AppModule {}
