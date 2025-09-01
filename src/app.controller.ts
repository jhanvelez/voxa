import { Controller, Post, Res, Body } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
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
