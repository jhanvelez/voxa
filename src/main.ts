import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
import * as fs from 'fs';
import * as https from 'https';
import { WebSocketServer } from 'ws';
import { VoiceGateway } from './voice/voice.gateway';

dotenv.config();

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/test.sustentiatec.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/test.sustentiatec.com/fullchain.pem'),
  };

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });

  app.enableCors({
    //origin: 'http://localhost:3000',
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Habilitar parsing de bodies (Twilio webhooks mandan x-www-form-urlencoded)
  app.use(express.urlencoded({ extended: true }));

  const server = app.getHttpServer();
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const voiceGateway = app.get(VoiceGateway);
    voiceGateway.handleConnection(ws, req);

    ws.on('close', () => {
      console.log('Twilio WS cerrado');
    });
  });

  server.on('upgrade', (req, socket, head) => {
    console.log('Activate');

    if (req.url.startsWith('/twilio-stream')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Nest app listening on http://localhost:${port}`);
}
bootstrap();
