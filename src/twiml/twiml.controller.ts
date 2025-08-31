// twiml.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as twilio from 'twilio';

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(
      { voice: 'alice', language: 'es-ES' },
      'Hola, esta es una llamada de prueba desde tu servidor NestJS.',
    );

    res.type('text/xml');
    res.send(twiml.toString());
  }
}
