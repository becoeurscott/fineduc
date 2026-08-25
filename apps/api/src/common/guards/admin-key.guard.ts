import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { loadEnv } from '@fineduc/config'

@Injectable()
export class AdminKeyGuard implements CanActivate {
  private readonly adminKey: string

  constructor() {
    this.adminKey = loadEnv().ADMIN_API_KEY
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.adminKey) {
      throw new UnauthorizedException('ADMIN_API_KEY is not configured')
    }

    const request = context.switchToHttp().getRequest<Request>()
    const key = request.headers['x-admin-key'] as string | undefined

    if (!key || key !== this.adminKey) {
      throw new UnauthorizedException('Invalid admin key')
    }

    return true
  }
}
