import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { AcademicYearService } from './academic-year.service.js'
import { ClassGroupService } from './class-group.service.js'
import { AcademicYearController } from './academic-year.controller.js'
import { ClassGroupController } from './class-group.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [AcademicYearController, ClassGroupController],
  providers: [AcademicYearService, ClassGroupService],
  exports: [AcademicYearService, ClassGroupService],
})
export class AcademicsModule {}
