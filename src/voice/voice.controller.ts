import { Controller, Post, Res, Body } from '@nestjs/common';
import { Response } from 'express';

@Controller('voice')
export class VoiceController {
  @Post()
  handleCall(@Res() res: Response) {
    console.log('Viene aqui');
    const twiml = `
      <Response>
        <Say voice="alice" language="es-ES">
          Hola, esta es una llamada automática de nuestro agente virtual.
        </Say>
        <Connect>
          <Stream url="wss://${process.env.PUBLIC_HOST}/twilio-stream"/>
        </Connect>
      </Response>
    `;
    res.type('text/xml');
    res.send(twiml);
  }

  @Post('status')
  handleStatus(@Body() body: any) {
    // Twilio te envía datos como CallSid, CallStatus, etc.
    console.log('📞 Status callback recibido:', body.CallStatus);

    // Aquí podrías guardar en DB, emitir evento, etc.
    return { received: true };
  }
}
