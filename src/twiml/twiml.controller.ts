// twiml.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { twiml } from 'twilio';

import { SayAttributes } from 'twilio/lib/twiml/VoiceResponse';

const attrs: SayAttributes = {
  voice: 'alice',
  language: 'es-ES',
};

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const voiceResponse = new twiml.VoiceResponse();

    voiceResponse.say(
      'Hola, esta es una llamada de prueba desde NestJS con Twilio.',
      attrs,
    );

    res.type('text/xml');
    res.send(voiceResponse.toString());
  }
}
