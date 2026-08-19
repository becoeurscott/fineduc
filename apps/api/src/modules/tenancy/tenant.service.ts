/**
 * Tenant management service. Onboard schools, update settings.
 * Currency and timezone are immutable after creation (ARCHITECTURE.md §5).
 */
import { Injectable } from '@nestjs/common'
import type { Prisma, TenantTransactionClient } from '@fineduc/db'
import { withTenant } from '@fineduc/db'
import { NotFoundError } from '@fineduc/domain'
import type { CreateTenantRequest, UpdateTenantRequest } from '@fineduc/contracts'
import { PrismaService } from '../platform/prisma.service.js'

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Onboard a new school. Creates the tenant, a default primary site,
   * and a subscription row (trial). The creating user's director membership
   * is handled by the caller (identity module's invite flow or a
   * dedicated onboarding endpoint).
   */
  async create(
    creatingUserId: string,
    input: CreateTenantRequest,
  ): Promise<{ tenantId: string; siteId: string }> {
    const tenantId = crypto.randomUUID()

    await withTenant(this.prisma.client, tenantId, async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: input.name,
          legalName: input.legalName ?? null,
          country: input.country,
          currency: input.currency,
          timezone: input.timezone,
          locale: input.locale ?? 'fr',
        },
      })

      // Default primary site — named after the school.
      await tx.site.create({
        data: {
          tenantId,
          name: input.name,
          isPrimary: true,
        },
      })

      // Director membership for the creating user.
      await tx.membership.create({
        data: {
          tenantId,
          userId: creatingUserId,
          role: 'director',
          status: 'active',
        },
      })

      // Trial subscription.
      const now = new Date()
      const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      await tx.subscription.create({
        data: {
          tenantId,
          plan: 'essentiel',
          billingPeriod: 'monthly',
          priceMinor: BigInt(0),
          currentPeriodStart: now,
          currentPeriodEnd: thirtyDaysLater,
          status: 'trialing',
        },
      })
    })

    // Retrieve the site id.
    const site = await withTenant(this.prisma.client, tenantId, async (tx) => {
      return tx.site.findFirst({ where: { tenantId, isPrimary: true } })
    })
    if (!site) {
      throw new NotFoundError('site', tenantId)
    }

    return { tenantId, siteId: site.id }
  }

  /**
   * Get the current tenant's details.
   */
  async get(tx: TenantTransactionClient, tenantId: string): Promise<{
    id: string; name: string; legalName: string | null; country: string
    currency: string; timezone: string; locale: string
    plan: string; status: string; logoUrl: string | null; createdAt: string
  }> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      throw new NotFoundError('tenant', tenantId)
    }
    return {
      id: tenant.id,
      name: tenant.name,
      legalName: tenant.legalName,
      country: tenant.country,
      currency: tenant.currency,
      timezone: tenant.timezone,
      locale: tenant.locale,
      plan: tenant.plan,
      status: tenant.status,
      logoUrl: tenant.logoUrl,
      createdAt: tenant.createdAt.toISOString(),
    }
  }

  /**
   * Update tenant (name, locale, logo, settings only — never currency or timezone).
   */
  async update(tx: TenantTransactionClient, tenantId: string, input: UpdateTenantRequest): Promise<void> {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.settings !== undefined ? { settings: input.settings as Prisma.InputJsonValue } : {}),
      },
    })
  }

  /**
   * Get the tenant's settings JSON.
   */
  async getSettings(tx: TenantTransactionClient, tenantId: string): Promise<unknown> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    if (!tenant) {
      throw new NotFoundError('tenant', tenantId)
    }
    return tenant.settings
  }
}
