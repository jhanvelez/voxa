// src/twiml/twiml.controller.ts
import { Controller, Get, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { twiml } from 'twilio';

@Controller()
export class TwimlController {
  private readonly logger = new Logger(TwimlController.name);

  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const vr = new twiml.VoiceResponse();
    vr.say(
      { voice: 'alice', language: 'es-ES' },
      'Un momento, conectando con el asistente.',
    );

    vr.connect().stream({
      url: 'wss://test.sustentiatec.com/voice-stream',
      // track: 'inbound', // opcional; por defecto Twilio envía el audio entrante (caller)
      // name: 'agente-voz', // opcional, útil para logs
    });

    const xml = vr.toString();
    this.logger.log(`Enviando TwiML: ${xml}`);

    res.set('Content-Type', 'application/xml');
    // Forzar encabezado XML al inicio (sin espacios en blanco)
    res.send(`<?xml version="1.0" encoding="UTF-8"?>${xml}`);
  }
}
