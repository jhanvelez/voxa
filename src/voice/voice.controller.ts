import { Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller('voice')
export class VoiceController {
  @Post()
  handleCall(@Res() res: Response) {
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${process.env.PUBLIC_HOST}/twilio-stream"/>
        </Connect>
      </Response>
    `;
    res.type('text/xml');
    res.send(twiml);
  }
}
