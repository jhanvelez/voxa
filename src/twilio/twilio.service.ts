import { Injectable } from '@nestjs/common';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private client: Twilio;

  constructor() {
    this.client = new Twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!,
    );
  }

  async makeCall(to: string, url: string) {
    return await this.client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
      url, // URL donde Twilio buscará el TwiML
      statusCallback: `${process.env.APP_URL}/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
  }
}
