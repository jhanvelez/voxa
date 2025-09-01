import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as twilio from 'twilio';

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const twiml = new twilio.twiml.VoiceResponse();

    const gather = twiml.gather({
      numDigits: 1,
      action: 'https://test.sustentiatec.com:3001/menu',
      method: 'POST',
    });

    gather.say(
      { voice: 'alice', language: 'es-ES' },
      'Bienvenido. Presione 1 para ventas. Presione 2 para soporte.',
    );

    twiml.say('No se recibió ninguna entrada. Adiós.');

    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>${twiml.toString()}`);
  }
}
