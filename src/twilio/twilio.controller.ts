import { Controller, Post, Body } from '@nestjs/common';
import { TwilioService } from './twilio.service';

@Controller('twilio')
export class TwilioController {
  constructor(private readonly twilioService: TwilioService) {}

  @Post('call')
  async makeCall(@Body() body: { to: string }) {
    console.log('Making call to:', body.to, 'with URL:', process.env.APP_URL);
    // Agregar parámetro para bypass de ngrok warning
    const twimlUrl = `${process.env.APP_URL || 'http://localhost:3000'}/twiml?ngrok-skip-browser-warning=true`;
    return this.twilioService.makeCall(body.to, twimlUrl);
  }
}
