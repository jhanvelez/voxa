// twiml.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { twiml } from 'twilio';

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const voiceResponse = new twiml.VoiceResponse();

    const mensaje: string =
      'Hola, esta es una llamada de prueba desde NestJS con Twilio.';

    const say = voiceResponse.say(mensaje);
    say.lang('es-ES');

    res.type('text/xml');
    res.send(voiceResponse.toString());
  }
}
