import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      // Anything not on the DTO is rejected rather than quietly dropped, so a typo in a
      // field name fails loudly instead of silently not taking effect.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: config.getOrThrow<string>('FRONTEND_URL'), credentials: true });

  await app.listen(config.get<number>('PORT') ?? 3000);
}

void bootstrap();
