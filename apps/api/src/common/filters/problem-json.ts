/**
 * RFC 9457 `application/problem+json` exception filter. Maps domain errors,
 * Zod validation errors, and NestJS HttpExceptions to a standard shape.
 * Unknown errors return 500 with a traceId and no internal details.
 *
 * ARCHITECTURE.md §12 / AGENTS.md: "typed domain errors in domain, mapped to
 * RFC 9457 problem+json at the HTTP edge."
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Response, Request } from 'express'
import { ZodError } from 'zod'
import {
  DomainError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  InvalidStateError,
  AuthenticationError,
} from '@fineduc/domain'

interface ProblemJson {
  type: string
  title: string
  status: number
  detail: string
  traceId?: string
  errors?: Record<string, string> | Array<{ path: string; message: string }>
}

function domainErrorStatus(error: DomainError): number {
  if (error instanceof NotFoundError) return 404
  if (error instanceof ConflictError) return 409
  if (error instanceof ForbiddenError) return 403
  if (error instanceof ValidationError) return 422
  if (error instanceof InvalidStateError) return 409
  if (error instanceof AuthenticationError) return 401
  return 500
}

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    // Every response gets a trace id — the request id if present, or a random one.
    const traceId =
      (request.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID()

    const problem = this.toProblem(exception, traceId)

    // Log server errors; client errors are noise.
    if (problem.status >= 500) {
      this.logger.error(
        `${problem.status} ${problem.title} [${traceId}]`,
        exception instanceof Error ? exception.stack : undefined,
      )
    }

    response.status(problem.status).contentType('application/problem+json').json(problem)
  }

  private toProblem(exception: unknown, traceId: string): ProblemJson {
    // Domain errors — the primary path.
    if (exception instanceof DomainError) {
      const status = domainErrorStatus(exception)
      const problem: ProblemJson = {
        type: `https://fineduc.com/errors/${exception.code}`,
        title: exception.name,
        status,
        detail: exception.message,
        traceId,
      }
      if (exception instanceof ValidationError && exception.fields) {
        problem.errors = exception.fields
      }
      return problem
    }

    // Zod validation errors — request body/query didn't parse.
    if (exception instanceof ZodError) {
      return {
        type: 'https://fineduc.com/errors/VALIDATION_ERROR',
        title: 'Validation Error',
        status: 422,
        detail: 'The request body contains invalid or missing fields.',
        traceId,
        errors: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }
    }

    // NestJS HttpExceptions — forwarded with the standard shape.
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const exceptionResponse = exception.getResponse()
      const detail =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message ?? exception.message
      return {
        type: `https://fineduc.com/errors/HTTP_${status}`,
        title: exception.name,
        status,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
        traceId,
      }
    }

    // Unknown errors — 500, no leak.
    return {
      type: 'https://fineduc.com/errors/INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      traceId,
    }
  }
}
