// src/twiml/twiml.controller.ts
import { Controller, Get, Post, Req, Res, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import * as twilio from 'twilio';

@Controller()
export class TwimlController {
  private readonly logger = new Logger(TwimlController.name);

  // Atiende GET y POST (Twilio puede usar POST por default)
  @Get('twiml')
  @Post('twiml')
  getTwiml(@Req() req: Request, @Res() res: Response) {
    this.logger.log(
      `Twiml requested. Method=${req.method} Headers=${JSON.stringify(req.headers)}`,
    );

    const vr = new twilio.twiml.VoiceResponse();

    // Opcional: saludo
    vr.say(
      { voice: 'alice', language: 'es-ES' },
      'Un momento, conectando con el asistente.',
    );

    // Conectar la llamada al WebSocket (twilio media streams)
    vr.connect().stream({
      url: 'wss://test.sustentiatec.com/voice-stream',
    });

    // Enviar XML EXACTO, sin espacios ni encabezados duplicados
    res.set('Content-Type', 'application/xml');
    res.send(vr.toString()); // twilio.twiml.VoiceResponse ya incluye la cabecera XML
  }
}
