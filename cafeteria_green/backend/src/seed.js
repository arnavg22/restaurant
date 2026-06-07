// ============================================================
// CAFETERIA GREEN — PRODUCTION SEED
// Seeds staff accounts + full menu from JSON files.
// Run: docker compose exec app node src/seed.js
// ============================================================
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
    console.log('\n🌿 Cafeteria Green — Seeding production data...\n');

    // ── 1. Staff accounts ──
    const password = await bcrypt.hash('cafegreen2026', 10);

    const users = [
        { email: 'admin', name: 'Restaurant Admin', role: 'admin', phone: '9000000001' },
        { email: 'kitchen', name: 'Kitchen Staff', role: 'kitchen', phone: '9000000002' },
        { email: 'developer', name: 'Platform Developer', role: 'developer', phone: '9000000003' },
    ];

    for (const u of users) {
        await prisma.user.upsert({
            where: { email: u.email },
            update: {},
            create: { ...u, passwordHash: password }
        });
        console.log(`  ✅ ${u.role}: ${u.email}`);
    }

    // ── 2. Menu items from JSON ──
    // Paths are relative to the monorepo project root (one level above backend/)
    const projectRoot = path.resolve(__dirname, '../../');
    const barMenu = JSON.parse(readFileSync(path.join(projectRoot, 'barmenu.json'), 'utf-8'));
    const foodMenu = JSON.parse(readFileSync(path.join(projectRoot, 'foodmenu.json'), 'utf-8'));
    const allItems = [...foodMenu, ...barMenu];

    // Clear existing data to avoid FK conflicts on re-seed
    await prisma.dealUsage.deleteMany({});
    await prisma.orderLog.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.menuItem.deleteMany({});
    console.log(`  🗑️  Cleared existing menu + order data`);

    let sortOrder = 0;
    for (const item of allItems) {
        sortOrder++;
        await prisma.menuItem.create({
            data: {
                name: item.name,
                description: item.description || null,
                price: item.price,
                category: item.category,
                section: item.section || 'Food',
                variants: item.variants || null,
                isAvailable: item.isAvailable !== false,
                sortOrder,
                developerDiscount: 0
            }
        });
    }
    console.log(`  ✅ Inserted ${allItems.length} menu items (${foodMenu.length} food + ${barMenu.length} bar)`);

    console.log('\n🌿 Seed complete!\n');
    console.log('  Login credentials (all passwords: cafegreen2026):');
    console.log('    Admin:     admin');
    console.log('    Kitchen:   kitchen');
    console.log('    Developer: developer\n');
}

main()
    .catch(e => { console.error('Seed failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
