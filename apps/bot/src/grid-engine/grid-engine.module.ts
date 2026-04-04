import { Module } from '@nestjs/common';
import { GridEngineService } from './grid-engine.service';
import { GridEngineController } from './grid-engine.controller';
import { GrvtExchangeService } from './grvt-exchange.service';
import { GrvtAuthModule } from '../auth/grvt-auth.module';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [GrvtAuthModule, MarketDataModule],
  providers: [GridEngineService, GrvtExchangeService],
  controllers: [GridEngineController],
  exports: [GridEngineService, GrvtExchangeService],
})
export class GridEngineModule {}
