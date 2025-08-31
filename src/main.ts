import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
import * as fs from 'fs';
import * as https from 'https';
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

  // Enable parsing of URL-encoded bodies (for Twilio webhook data)
  app.use(express.urlencoded({ extended: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Nest app listening on http://localhost:${port}`);
}
bootstrap();
