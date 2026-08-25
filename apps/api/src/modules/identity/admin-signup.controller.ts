import { Controller, Get, Param, Post, Body, UseGuards, HttpCode, HttpException, HttpStatus } from '@nestjs/common'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { AdminKeyGuard } from '../../common/guards/admin-key.guard.js'
import { SetupService, SetupError } from './setup.service.js'
import { z } from 'zod'

const RejectBodySchema = z.object({
  reason: z.string().min(1).max(500),
})

@Controller('admin/signups')
@Public()
@SkipAudit()
@UseGuards(AdminKeyGuard)
export class AdminSignupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  async list() {
    return this.setup.listSignupRequests()
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string) {
    try {
      return await this.setup.approveSignup(id)
    } catch (err) {
      if (err instanceof SetupError) {
        const status =
          err.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }

  @Post(':id/reissue-code')
  @HttpCode(200)
  async reissueCode(@Param('id') id: string) {
    try {
      return await this.setup.reissueCode(id)
    } catch (err) {
      if (err instanceof SetupError) {
        const status =
          err.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown) {
    const { reason } = RejectBodySchema.parse(body)
    try {
      await this.setup.rejectSignup(id, reason)
      return { ok: true }
    } catch (err) {
      if (err instanceof SetupError) {
        const status =
          err.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }
}
