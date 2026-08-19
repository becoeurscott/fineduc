import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { TenantService } from './tenant.service.js'
import { SiteService } from './site.service.js'
import { TenantController } from './tenant.controller.js'
import { SiteController } from './site.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [TenantController, SiteController],
  providers: [TenantService, SiteService],
  exports: [TenantService],
})
export class TenancyModule {}
