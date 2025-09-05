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

    // Obtener parámetros de la query string
    const customerName = req.query.customerName as string;
    const debtAmount = req.query.debtAmount as string;

    this.logger.log(`Customer data: name=${customerName}, debt=${debtAmount}`);

    const vr = new twilio.twiml.VoiceResponse();

    // Conectar la llamada al WebSocket con parámetros
    const streamUrl = 'wss://voxa.asistencia360.co:3001/twilio-stream';
    const streamParams = new URLSearchParams();
    if (customerName) streamParams.append('customerName', customerName);
    if (debtAmount) streamParams.append('debtAmount', debtAmount);

    const fullStreamUrl = streamParams.toString()
      ? `${streamUrl}?${streamParams.toString()}`
      : streamUrl;

    vr.connect().stream({
      url: fullStreamUrl,
    });

    // Enviar XML EXACTO, sin espacios ni encabezados duplicados
    res.set('Content-Type', 'application/xml');
    res.send(vr.toString()); // twilio.twiml.VoiceResponse ya incluye la cabecera XML
  }
}
