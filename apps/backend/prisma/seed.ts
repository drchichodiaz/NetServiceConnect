import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo',
      plan: 'starter',
    },
  });

  const hash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      password: hash,
      name: 'Admin Demo',
      role: 'ADMIN',
    },
  });

  console.log('Seed completed for tenant:', tenant.slug);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
