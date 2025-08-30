import { Controller, Get, Post, Res, Body } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get('twiml')
  getTwiml(@Res() res: Response) {
    console.log('🎯 TwiML endpoint called');
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';

    const response = `
    <Response>
      <Gather numDigits="1" action="${baseUrl}/menu" method="POST">
        <Say voice="alice">Bienvenido. Presione 1 para ventas. Presione 2 para soporte.</Say>
      </Gather>
      <Say>No se recibió ninguna entrada. Adiós.</Say>
    </Response>
  `;

    res.set('ngrok-skip-browser-warning', 'true');
    res.type('text/xml');
    res.send(response);
  }

  @Post('menu')
  handleMenu(@Body() body: any, @Res() res: Response) {
    console.log(
      '📞 Menu endpoint called with body:',
      JSON.stringify(body, null, 2),
    );

    const digit = body.Digits;
    console.log('🔢 Digit pressed:', digit);

    let response = `
    <Response>
      <Say>No se recibió una opción válida. Presionó: ${digit || 'ninguna tecla'}</Say>
    </Response>
  `;

    if (digit === '1') {
      response = `
      <Response>
        <Say>Conectando con ventas. Su solicitud fue procesada exitosamente.</Say>
      </Response>
    `;
    } else if (digit === '2') {
      response = `
      <Response>
        <Say>Conectando con soporte técnico. Su solicitud fue procesada exitosamente.</Say>
      </Response>
    `;
    }

    res.set('ngrok-skip-browser-warning', 'true');
    res.type('text/xml');
    res.send(response);
  }
}
