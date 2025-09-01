import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { twiml } from 'twilio';

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const voiceResponse = new twiml.VoiceResponse();
    voiceResponse.say('Hola, esta es tu propia respuesta personalizada.');
    //res.type('text/xml');
    res.set('Content-Type', 'application/xml');
    res.send(voiceResponse.toString());
  }
}
