import { Module } from '@nestjs/common';
import { GrvtAuthService } from './grvt-auth.service';

@Module({
  providers: [GrvtAuthService],
  exports: [GrvtAuthService],
})
export class GrvtAuthModule {}
