import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable parsing of URL-encoded bodies (for Twilio webhook data)
  app.use(express.urlencoded({ extended: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Nest app listening on http://localhost:${port}`);
}
bootstrap();
