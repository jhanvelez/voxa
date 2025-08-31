import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
import { WebSocketServer } from 'ws';
import { VoiceGateway } from './voice/voice.gateway';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilitar parsing de bodies (Twilio webhooks mandan x-www-form-urlencoded)
  app.use(express.urlencoded({ extended: true }));

  const server = app.getHttpServer();

  // Crear WebSocketServer sin puerto propio
  const wss = new WebSocketServer({ noServer: true });

  // Manejar conexiones entrantes de Twilio
  wss.on('connection', (ws, req) => {
    console.log('Twilio WS conectado', req);

    const voiceGateway = app.get(VoiceGateway);
    voiceGateway.handleConnection(ws);

    ws.on('message', (msg) => {
      const data = JSON.parse(msg.toString());
      console.log('Mensaje WS:', data);

      // Ejemplo: echo test
      if (data.event === 'media') {
        ws.send(
          JSON.stringify({
            event: 'media',
            streamSid: data.streamSid,
            media: { payload: data.media.payload },
          }),
        );
      }
    });

    ws.on('close', () => {
      console.log('Twilio WS cerrado');
    });
  });

  // Interceptar upgrade (HTTP → WS)
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/twilio-stream') {
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
