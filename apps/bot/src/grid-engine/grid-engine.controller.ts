import { Controller, Post, Get, Patch, Param, Body, HttpCode, Query } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GridEngineService } from './grid-engine.service';
import type { GridConfig } from '@grvt-grid-bot/shared';

@Controller('grids')
export class GridEngineController {
  constructor(
    private readonly gridEngine: GridEngineService,
    private readonly prisma: PrismaService,
  ) {}

  /** List all grids */
  @Get()
  async listGrids() {
    return this.prisma.grid.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Get a single grid */
  @Get(':id')
  async getGrid(@Param('id') id: string) {
    return this.prisma.grid.findUniqueOrThrow({ where: { id } });
  }

  /** Create and start a new grid */
  @Post()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createGrid(@Body() config: GridConfig): Promise<any> {
    return this.gridEngine.startGrid(config);
  }

  /** Update price range of an active grid — cancels and replaces all orders */
  @Patch(':id/range')
  @HttpCode(200)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateRange(
    @Param('id') id: string,
    @Body() body: { lowerPrice: number; upperPrice: number; gridCount?: number },
  ): Promise<any> {
    return this.gridEngine.updateGridRange(id, body);
  }

  /** Stop a grid and cancel all orders */
  @Post(':id/stop')
  @HttpCode(200)
  async stopGrid(@Param('id') id: string) {
    await this.gridEngine.stopGrid(id);
    return { success: true };
  }

  /** Computed stats — Pionex summary panel */
  @Get(':id/stats')
  async getStats(@Param('id') id: string) {
    return this.gridEngine.getStats(id);
  }

  /** Orders for a grid — Pionex "Colocadas" tab */
  @Get(':id/orders')
  async getOrders(@Param('id') id: string, @Query('status') status?: string) {
    return this.gridEngine.getOrders(id, status);
  }

  /** Completed trades — Pionex "Transacciones" tab */
  @Get(':id/trades')
  async getTrades(@Param('id') id: string) {
    return this.gridEngine.getTrades(id);
  }

  /** Funding rate history — Pionex "Historial de financiación" */
  @Get(':id/funding')
  async getFunding(@Param('id') id: string) {
    return this.gridEngine.getFundingHistory(id);
  }

  /** PnL snapshots for chart — Pionex "Resumen" chart */
  @Get(':id/pnl')
  async getPnl(@Param('id') id: string) {
    return this.gridEngine.getPnlSnapshots(id);
  }
}
