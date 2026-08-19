import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { PrismaService } from './prisma.service.js'
import { RedisService } from './redis.service.js'

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class PlatformModule {}
