import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { AuditService } from './audit.service.js'
import { AuditController } from './audit.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
