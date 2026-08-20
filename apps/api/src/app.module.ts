import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { PlatformModule } from './modules/platform/platform.module.js'
import { IdentityModule } from './modules/identity/identity.module.js'
import { TenancyModule } from './modules/tenancy/tenancy.module.js'
import { AcademicsModule } from './modules/academics/academics.module.js'
import { StudentsModule } from './modules/students/students.module.js'
import { BillingModule } from './modules/billing/billing.module.js'
import { CashboxModule } from './modules/cashbox/cashbox.module.js'
import { PaymentsModule } from './modules/payments/payments.module.js'
import { AuditModule } from './modules/audit/audit.module.js'
import { ProblemJsonFilter } from './common/filters/problem-json.js'
import { AuthGuard } from './common/guards/auth.guard.js'
import { RolesGuard } from './common/guards/roles.js'
import { TenantContextInterceptor } from './common/interceptors/tenant-context.js'
import { AuditInterceptor } from './common/interceptors/audit.js'

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    TenancyModule,
    AcademicsModule,
    StudentsModule,
    BillingModule,
    CashboxModule,
    PaymentsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemJsonFilter,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
