import { Controller, Post, Param, Body, HttpCode, Logger } from '@nestjs/common';
import { GridEngineService } from './grid-engine.service';
import type { GridConfig } from '@grvt-grid-bot/shared';

@Controller('grids')
export class GridEngineController {
  private readonly logger = new Logger(GridEngineController.name);

  constructor(private readonly gridEngine: GridEngineService) {}

  @Post()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createGrid(@Body() config: GridConfig): Promise<any> {
    return this.gridEngine.startGrid(config);
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stopGrid(@Param('id') id: string) {
    await this.gridEngine.stopGrid(id);
    return { success: true };
  }
}
