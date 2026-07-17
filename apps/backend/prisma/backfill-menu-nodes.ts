import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Mismo formato que armaba `showBranchDetails` en bot.service.ts antes del arbol generico. */
function branchDetailText(branch: {
  name: string;
  address: string;
  scheduleText: string | null;
  phone: string | null;
  mapsUrl: string | null;
  servicesText: string | null;
}): string {
  const lines = [`🏬 ${branch.name}`, `📍 ${branch.address}`];
  if (branch.scheduleText) lines.push(`🕐 ${branch.scheduleText}`);
  if (branch.phone) lines.push(`☎️ ${branch.phone}`);
  if (branch.mapsUrl) lines.push(branch.mapsUrl);
  if (branch.servicesText) lines.push('', `Servicios disponibles: ${branch.servicesText}`);
  return lines.join('\n');
}

async function backfillTenant(tenant: { id: string; slug: string }) {
  const existing = await prisma.tenantMenuNode.count({ where: { tenantId: tenant.id } });
  if (existing > 0) {
    console.log(`Skip ${tenant.slug}: ya tiene ${existing} nodos de menu`);
    return;
  }

  const [config, branches] = await Promise.all([
    prisma.tenantBotConfig.findUnique({ where: { tenantId: tenant.id } }),
    prisma.tenantBranch.findMany({ where: { tenantId: tenant.id }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  ]);

  await prisma.$transaction(async (tx) => {
    let sortOrder = 0;

    await tx.tenantMenuNode.create({
      data: {
        tenantId: tenant.id,
        parentId: null,
        type: 'TEXT',
        title: 'Horarios',
        bodyText: config?.horariosText || null,
        sortOrder: sortOrder++,
      },
    });

    if (branches.length > 0) {
      const sucursales = await tx.tenantMenuNode.create({
        data: { tenantId: tenant.id, parentId: null, type: 'MENU', title: 'Sucursales', sortOrder: sortOrder++ },
      });
      let branchOrder = 0;
      for (const branch of branches) {
        await tx.tenantMenuNode.create({
          data: {
            tenantId: tenant.id,
            parentId: sucursales.id,
            type: 'TEXT',
            title: branch.name,
            subtitle: branch.address,
            bodyText: branchDetailText(branch),
            active: branch.active,
            sortOrder: branchOrder++,
          },
        });
      }
    } else {
      await tx.tenantMenuNode.create({
        data: {
          tenantId: tenant.id,
          parentId: null,
          type: 'TEXT',
          title: 'Sucursales',
          bodyText: config?.sucursalesText || null,
          sortOrder: sortOrder++,
        },
      });
    }

    await tx.tenantMenuNode.create({
      data: {
        tenantId: tenant.id,
        parentId: null,
        type: 'TEXT',
        title: 'Servicios',
        bodyText: config?.serviciosText || null,
        sortOrder: sortOrder++,
      },
    });

    await tx.tenantMenuNode.create({
      data: { tenantId: tenant.id, parentId: null, type: 'ORDER_LOOKUP', title: 'Consultar mi orden', sortOrder: sortOrder++ },
    });

    await tx.tenantMenuNode.create({
      data: { tenantId: tenant.id, parentId: null, type: 'AGENT', title: 'Hablar con un agente', sortOrder: sortOrder++ },
    });
  });

  console.log(`Backfill completo para ${tenant.slug} (${branches.length} sucursales migradas)`);
}

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    await backfillTenant(tenant);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
