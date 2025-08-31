import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as twilio from 'twilio';

@Controller()
export class TwimlController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    const twiml = new twilio.twiml.VoiceResponse();

    // 🔑 Importante: usar <Connect><Stream> en vez de <Say>
    twiml.connect().stream({
      url: 'wss://test.sustentiatec.com/voice-stream', // tu endpoint público WS
    });

    res.type('text/xml');
    res.send(twiml.toString());
  }
}
