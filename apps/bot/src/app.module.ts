import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GrvtAuthModule } from './auth/grvt-auth.module';
import { GridEngineModule } from './grid-engine/grid-engine.module';
import { MarketDataModule } from './market-data/market-data.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    GrvtAuthModule,
    MarketDataModule,
    GridEngineModule,
  ],
})
export class AppModule {}
