// ============================================================
// SEED DATA — Initial setup for Cafeteria Green
// ============================================================
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
    console.log('🌱 Seeding database...\n');

    // ── 1. Create system users ──
    const password = await bcrypt.hash('CafeGreen@2026', 10);

    const developer = await prisma.user.upsert({
        where: { email: 'dev@cafeteriagrean.in' },
        update: {},
        create: {
            name: 'Platform Admin',
            email: 'dev@cafeteriagrean.in',
            phone: '9000000000',
            passwordHash: password,
            role: 'developer'
        }
    });
    console.log(`  ✅ Developer: ${developer.email}`);

    const admin = await prisma.user.upsert({
        where: { email: 'admin@cafeteriagrean.in' },
        update: {},
        create: {
            name: 'Restaurant Admin',
            email: 'admin@cafeteriagrean.in',
            phone: '9000000001',
            passwordHash: password,
            role: 'admin'
        }
    });
    console.log(`  ✅ Admin: ${admin.email}`);

    const delivery = await prisma.user.upsert({
        where: { email: 'delivery@cafeteriagrean.in' },
        update: {},
        create: {
            name: 'Delivery Person',
            email: 'delivery@cafeteriagrean.in',
            phone: '9000000002',
            passwordHash: password,
            role: 'delivery'
        }
    });
    console.log(`  ✅ Delivery: ${delivery.email}`);

    // ── 2. Sample menu items ──
    const menuItems = [
        // Main Course
        { name: 'Paneer Butter Masala', description: 'Creamy paneer in rich tomato gravy', price: 180, category: 'Main Course', sortOrder: 1 },
        { name: 'Dal Makhani', description: 'Slow-cooked black lentils with butter', price: 150, category: 'Main Course', sortOrder: 2 },
        { name: 'Chole Bhature', description: 'Spicy chickpea curry with fluffy bhature', price: 120, category: 'Main Course', sortOrder: 3 },
        { name: 'Veg Biryani', description: 'Fragrant rice with mixed vegetables', price: 160, category: 'Main Course', sortOrder: 4 },
        { name: 'Egg Curry', description: 'Boiled eggs in spicy onion-tomato gravy', price: 140, category: 'Main Course', sortOrder: 5 },

        // Rice & Bread
        { name: 'Jeera Rice', description: 'Cumin-flavored basmati rice', price: 60, category: 'Rice & Bread', sortOrder: 1 },
        { name: 'Butter Naan', description: 'Soft tandoori bread with butter', price: 40, category: 'Rice & Bread', sortOrder: 2 },
        { name: 'Garlic Naan', description: 'Naan topped with garlic and coriander', price: 50, category: 'Rice & Bread', sortOrder: 3 },
        { name: 'Tandoori Roti', description: 'Whole wheat tandoori bread', price: 30, category: 'Rice & Bread', sortOrder: 4 },

        // Snacks
        { name: 'Samosa (2 pcs)', description: 'Crispy pastry with spiced potato filling', price: 40, category: 'Snacks', sortOrder: 1 },
        { name: 'Veg Manchurian', description: 'Indo-Chinese crispy veggie balls', price: 120, category: 'Snacks', sortOrder: 2 },
        { name: 'French Fries', description: 'Golden crispy fries with masala', price: 80, category: 'Snacks', sortOrder: 3 },
        { name: 'Spring Rolls (4 pcs)', description: 'Crunchy veggie spring rolls', price: 100, category: 'Snacks', sortOrder: 4 },

        // Beverages
        { name: 'Masala Chai', description: 'Spiced Indian tea with milk', price: 30, category: 'Beverages', sortOrder: 1 },
        { name: 'Cold Coffee', description: 'Iced coffee with milk and cream', price: 80, category: 'Beverages', sortOrder: 2 },
        { name: 'Mango Lassi', description: 'Sweet yogurt drink with mango', price: 60, category: 'Beverages', sortOrder: 3 },
        { name: 'Fresh Lime Soda', description: 'Refreshing lime with soda water', price: 40, category: 'Beverages', sortOrder: 4 },
        { name: 'Mineral Water', description: '500ml bottle', price: 20, category: 'Beverages', sortOrder: 5 },

        // Desserts
        { name: 'Gulab Jamun (2 pcs)', description: 'Milk dumplings in sugar syrup', price: 50, category: 'Desserts', sortOrder: 1 },
        { name: 'Rasmalai (2 pcs)', description: 'Cottage cheese in saffron milk', price: 70, category: 'Desserts', sortOrder: 2 },
        { name: 'Ice Cream Scoop', description: 'Vanilla / Chocolate / Strawberry', price: 60, category: 'Desserts', sortOrder: 3 },
    ];

    for (const item of menuItems) {
        await prisma.menuItem.create({ data: item });
    }
    console.log(`  ✅ Menu items: ${menuItems.length} created`);

    // ── 3. Sample deal ──
    const now = new Date();
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await prisma.deal.create({
        data: {
            title: '₹50 off on orders above ₹300',
            description: 'Get ₹50 off when you order ₹300 or more. Discount from our share!',
            discountType: 'flat',
            discountValue: 50,
            minOrderAmount: 300,
            startsAt: now,
            expiresAt: nextMonth,
            maxUsesPerUser: 3,
            createdBy: developer.id
        }
    });

    await prisma.deal.create({
        data: {
            title: '10% off (max ₹100)',
            description: 'Get 10% off your order, up to ₹100. Discount from our share!',
            discountType: 'percent',
            discountValue: 10,
            maxDiscountAmount: 100,
            minOrderAmount: 200,
            startsAt: now,
            expiresAt: nextMonth,
            maxUsesPerUser: 5,
            createdBy: developer.id
        }
    });

    console.log('  ✅ Sample deals: 2 created');

    // ── Done ──
    console.log('\n🌿 Seed complete!\n');
    console.log('  Login credentials (all):');
    console.log('    Password: CafeGreen@2026');
    console.log('    Developer: dev@cafeteriagrean.in');
    console.log('    Admin:     admin@cafeteriagrean.in');
    console.log('    Delivery:  delivery@cafeteriagrean.in\n');
}

seed()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
