import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

// PrismaClient is generated after `prisma generate`. Import dynamically to avoid
// compile-time errors before the client has been generated.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
