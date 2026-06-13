// ============================================================
// CREATE DISCOUNT-PANEL USER (non-destructive)
// Adds (or updates) only the 'discount' role account.
// Does NOT touch menu items, orders, or any other data.
//
// Run: docker compose exec app node src/create-discount-user.js
//      (or: node src/create-discount-user.js)
//
// Optional overrides via env: DISCOUNT_EMAIL, DISCOUNT_PASSWORD, DISCOUNT_NAME, DISCOUNT_PHONE
// ============================================================
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = process.env.DISCOUNT_EMAIL || 'discount';
    const password = process.env.DISCOUNT_PASSWORD || 'cafegreen2026';
    const name = process.env.DISCOUNT_NAME || 'Discount Manager';
    const phone = process.env.DISCOUNT_PHONE || '9000000004';

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
        where: { email },
        // If it already exists, just make sure the role/password are set — no other data touched.
        update: { role: 'discount', passwordHash },
        create: { email, name, phone, passwordHash, role: 'discount' }
    });

    console.log(`\n✅ Discount Panel user ready:`);
    console.log(`   email: ${user.email}`);
    console.log(`   password: ${password}`);
    console.log(`   role: ${user.role}\n`);
}

main()
    .catch((e) => { console.error('❌ Failed:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
