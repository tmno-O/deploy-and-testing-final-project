import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';

/** Every route requires a valid User Service JWT whose `sub` is listed in ADMIN_USER_IDS. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private actor(req: AuthedRequest): string {
    return req.auth!.userId;
  }

  @Post('cards')
  createCard(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.admin.createCard(this.actor(req), body);
  }

  @Patch('cards/:id')
  updateCard(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.updateCard(this.actor(req), id, body);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  deleteCard(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.admin.deleteCard(this.actor(req), id);
  }

  @Get('packs')
  listPacks() {
    return this.admin.listPacks();
  }

  @Post('packs')
  createPack(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.admin.createPack(this.actor(req), body);
  }

  @Patch('packs/:id')
  updatePack(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.updatePack(this.actor(req), id, body);
  }

  @Put('inventory/:cardId')
  setStock(@Req() req: AuthedRequest, @Param('cardId') cardId: string, @Body() body: unknown) {
    return this.admin.setStock(this.actor(req), cardId, body);
  }
}
