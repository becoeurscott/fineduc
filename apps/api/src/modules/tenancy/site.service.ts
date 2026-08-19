/**
 * Site (campus) management service.
 */
import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { NotFoundError } from '@fineduc/domain'
import type { CreateSiteRequest, UpdateSiteRequest } from '@fineduc/contracts'

@Injectable()
export class SiteService {
  /**
   * List all sites for this tenant.
   */
  async list(tx: TenantTransactionClient, tenantId: string): Promise<Array<{
    id: string; name: string; address: string | null
    isPrimary: boolean; createdAt: string
  }>> {
    const sites = await tx.site.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    })
    return sites.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      isPrimary: s.isPrimary,
      createdAt: s.createdAt.toISOString(),
    }))
  }

  /**
   * Create a new site (campus).
   */
  async create(tx: TenantTransactionClient, tenantId: string, input: CreateSiteRequest): Promise<{
    id: string; name: string; address: string | null; isPrimary: boolean
  }> {
    const site = await tx.site.create({
      data: {
        tenantId,
        name: input.name,
        address: input.address ?? null,
        isPrimary: false,
      },
    })
    return {
      id: site.id,
      name: site.name,
      address: site.address,
      isPrimary: site.isPrimary,
    }
  }

  /**
   * Update a site's name or address.
   */
  async update(
    tx: TenantTransactionClient,
    tenantId: string,
    siteId: string,
    input: UpdateSiteRequest,
  ): Promise<void> {
    const site = await tx.site.findFirst({ where: { id: siteId, tenantId } })
    if (!site) {
      throw new NotFoundError('site', siteId)
    }
    await tx.site.update({
      where: { id: siteId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
    })
  }
}
