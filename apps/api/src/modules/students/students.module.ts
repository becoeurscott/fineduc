import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { StudentService } from './student.service.js'
import { GuardianService } from './guardian.service.js'
import { EnrollmentService } from './enrollment.service.js'
import { StudentController } from './student.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [StudentController],
  providers: [StudentService, GuardianService, EnrollmentService],
  exports: [StudentService, GuardianService, EnrollmentService],
})
export class StudentsModule {}
