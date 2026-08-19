import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { loadEnv } from '@fineduc/config'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { PrismaService } from './prisma.service.js'
import { RedisService } from './redis.service.js'

@Public()
@SkipAudit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness — the process is up. No dependency checks; a load balancer polls this. */
  @Get()
  liveness(): { status: 'ok'; service: string; time: string } {
    return { status: 'ok', service: 'fineduc-api', time: new Date().toISOString() }
  }

  /** Readiness — safe to receive traffic. Checked before this instance joins rotation. */
  @Get('ready')
  async readiness(): Promise<{ status: 'ok'; checks: Record<string, 'ok'> }> {
    const checks: Record<string, 'ok'> = {}
    const failures: string[] = []

    await this.prisma
      .ping()
      .then(() => {
        checks.database = 'ok'
      })
      .catch(() => failures.push('database'))

    await this.redis
      .ping()
      .then(() => {
        checks.redis = 'ok'
      })
      .catch(() => failures.push('redis'))

    if (failures.length > 0) {
      throw new ServiceUnavailableException({ status: 'unavailable', failing: failures })
    }
    return { status: 'ok', checks }
  }

  /**
   * Provider configuration status. No PaymentProvider/MessagingProvider
   * adapters exist yet (ARCHITECTURE.md §9, build order phases 6-7) — this
   * reports env-level configuration presence only, not a live connectivity
   * check, and says so explicitly rather than implying more than it knows.
   */
  @Get('providers')
  providers(): { status: 'not_implemented'; configured: Record<string, boolean> } {
    const env = loadEnv()
    return {
      status: 'not_implemented',
      configured: {
        cinetpay: Boolean(env.CINETPAY_API_KEY),
        whatsapp: Boolean(env.WHATSAPP_ACCESS_TOKEN),
        sms: Boolean(env.SMS_API_KEY),
        s3: Boolean(env.S3_BUCKET),
        sentry: Boolean(env.SENTRY_DSN),
      },
    }
  }
}
