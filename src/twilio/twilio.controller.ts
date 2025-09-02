import { Controller, Post, Body } from '@nestjs/common';
import { TwilioService } from './twilio.service';

@Controller('twilio')
export class TwilioController {
  constructor(private readonly twilioService: TwilioService) {}

  @Post('call')
  async makeCall(
    @Body() body: { to: string; customerName?: string; debtAmount?: string },
  ) {
    console.log(
      'Iniciando llamada a:',
      body.to,
      'with URL:',
      process.env.APP_URL,
    );

    // Agregar parámetro para bypass de ngrok warning
    const twimlUrl = `${process.env.APP_URL}/twiml`;

    // Datos del cliente
    const customerData = {
      name: body.customerName,
      debt: body.debtAmount,
    };

    return this.twilioService.makeCall(body.to, twimlUrl, customerData);
  }
}
