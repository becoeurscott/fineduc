/**
 * JWT authentication guard. Verifies the `Authorization: Bearer <token>`
 * header and attaches the decoded payload to `request.user`.
 *
 * Routes decorated with @Public() skip verification entirely. Every other
 * route requires a valid JWT — this is enforced globally by registering
 * this guard as APP_GUARD in the AppModule.
 */
import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import jwt from 'jsonwebtoken'
import { loadEnv } from '@fineduc/config'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js'

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name)
  private readonly jwtSecret: string

  constructor(private readonly reflector: Reflector) {
    const env = loadEnv()
    this.jwtSecret = env.JWT_SECRET
  }

  canActivate(context: ExecutionContext): boolean {
    // Skip for @Public() routes.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<Request>()
    const token = this.extractToken(request)
    if (!token) {
      throw new UnauthorizedException('Missing authorization header')
    }

    try {
      const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload
      const user: AuthenticatedUser = {
        userId: payload.sub as string,
        tenantId: payload.tenantId as string,
        role: payload.role as string,
        email: payload.email as string,
      }
      ;(request as Request & { user: AuthenticatedUser }).user = user
      return true
    } catch (error) {
      this.logger.debug(`JWT verification failed: ${error instanceof Error ? error.message : 'unknown'}`)
      throw new UnauthorizedException('Invalid or expired token')
    }
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization
    if (!authHeader) return undefined
    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !token) return undefined
    return token
  }
}
