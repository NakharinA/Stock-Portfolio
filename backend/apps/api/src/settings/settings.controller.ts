import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateBrokerSettingDto } from './dto/update-broker-setting.dto';
import { SettingsService } from './settings.service';

@Controller('settings/broker')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  find(@CurrentUser() userId: string) {
    return this.settings.find(userId);
  }

  @Put()
  update(@CurrentUser() userId: string, @Body() dto: UpdateBrokerSettingDto) {
    return this.settings.update(userId, dto);
  }
}
