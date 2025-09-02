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

  async makeCall(
    to: string,
    url: string,
    customerData?: { name?: string; debt?: string },
  ) {
    // Construir URL con parámetros
    let fullUrl = url;
    if (customerData) {
      const params = new URLSearchParams();
      if (customerData.name) params.append('customerName', customerData.name);
      if (customerData.debt) params.append('debtAmount', customerData.debt);
      fullUrl = `${url}?${params.toString()}`;
    }

    return await this.client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
      url: fullUrl, // URL donde Twilio buscará el TwiML con parámetros
      method: 'GET',
      statusCallback: `${process.env.APP_URL}/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
  }

  async hangupCall(callSid: string) {
    try {
      await this.client.calls(callSid).update({ status: 'completed' });
      return true;
    } catch (error) {
      console.error('Error hanging up call:', error);
      return false;
    }
  }
}
