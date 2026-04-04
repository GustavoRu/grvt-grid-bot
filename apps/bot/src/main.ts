import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors();

  const port = process.env.BOT_PORT ?? 3001;
  await app.listen(port);
  Logger.log(`🤖 GRVT Grid Bot running on port ${port}`, 'Bootstrap');
}

bootstrap();
