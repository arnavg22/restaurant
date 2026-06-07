// ============================================================
// SEED DATA — Initial setup for FORCO AMORE
// ============================================================
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
    console.log('🌱 Seeding database...\\n');

    // ── 1. Create system users ──
    const password = await bcrypt.hash('forcoamore', 10);

    await prisma.dealUsage.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.orderLog.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.passwordReset.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { notIn: ['dev@forcoamore.com', 'admin@forcoamore.com', 'delivery@forcoamore.com', 'kitchen@forcoamore.com'] } } });

    const developer = await prisma.user.upsert({
        where: { email: 'dev@forcoamore.com' },
        update: { passwordHash: password },
        create: {
            name: 'Platform Admin',
            email: 'dev@forcoamore.com',
            phone: '9000000000',
            passwordHash: password,
            role: 'developer'
        }
    });
    console.log(`  ✅ Developer: ${developer.email}`);

    const admin = await prisma.user.upsert({
        where: { email: 'admin@forcoamore.com' },
        update: { passwordHash: password },
        create: {
            name: 'Restaurant Admin',
            email: 'admin@forcoamore.com',
            phone: '9000000001',
            passwordHash: password,
            role: 'admin'
        }
    });
    console.log(`  ✅ Admin: ${admin.email}`);

    const delivery = await prisma.user.upsert({
        where: { email: 'delivery@forcoamore.com' },
        update: { passwordHash: password },
        create: {
            name: 'Delivery Person',
            email: 'delivery@forcoamore.com',
            phone: '9000000002',
            passwordHash: password,
            role: 'delivery'
        }
    });
    console.log(`  ✅ Delivery: ${delivery.email}`);

    const kitchen = await prisma.user.upsert({
        where: { email: 'kitchen@forcoamore.com' },
        update: { passwordHash: password },
        create: {
            name: 'Kitchen Staff',
            email: 'kitchen@forcoamore.com',
            phone: '9000000003',
            passwordHash: password,
            role: 'kitchen'
        }
    });
    console.log(`  ✅ Kitchen: ${kitchen.email}`);

    // ── 2. Menu items ──
    const menuItems = [
        // Morning Feast
        { name: 'Bun Maska', price: 49, category: 'Morning Feast' },
        { name: 'Kanda Poha', price: 69, category: 'Morning Feast' },
        { name: 'South Indian Upma', price: 69, category: 'Morning Feast' },
        { name: 'Veg Besan Omelette', price: 69, category: 'Morning Feast' },
        { name: 'Vada Pav', price: 69, category: 'Morning Feast' },
        { name: 'Puri Bhaji', price: 69, category: 'Morning Feast' },
        { name: 'Idli with Podi', price: 79, category: 'Morning Feast' },
        { name: 'Savory Veg Pancake', price: 119, category: 'Morning Feast' },
        { name: 'Sautéed Garden Vegetables', price: 119, category: 'Morning Feast' },
        { name: 'Pakoda', price: 99, category: 'Morning Feast' },
        { name: 'Chole Bhature (Till 3 PM)', price: 129, category: 'Morning Feast' },
        { name: 'Banana & Almond Butter Oatmeal', price: 149, category: 'Morning Feast' },
        { name: 'Berry Chia Tapioca Pudding', price: 149, category: 'Morning Feast' },
        { name: 'Blueberry Banana Overnight Oats', price: 149, category: 'Morning Feast' },
        { name: 'Boiled Eggs & Butter Toast', price: 79, category: 'Morning Feast' },
        { name: 'Masala Omelette', price: 99, category: 'Morning Feast' },
        { name: 'Chicken Keema Pav', price: 119, category: 'Morning Feast' },
        { name: 'Chicken Sausage with Toast', price: 149, category: 'Morning Feast' },
        { name: 'Scrambled Eggs with Butter Toast', price: 129, category: 'Morning Feast' },

        // Pasta
        { name: 'Alfredo Creamy White Sauce Pasta', price: 149, category: 'Pasta' },
        { name: 'Arrabbiata Pasta', price: 149, category: 'Pasta' },
        { name: 'Aglio e Olio', price: 129, category: 'Pasta' },
        { name: 'Mushroom Florentine Pasta', price: 149, category: 'Pasta' },
        { name: 'Ravioli Spinach Corn', price: 199, category: 'Pasta' },
        { name: 'Ravioli Arrabbiata', price: 199, category: 'Pasta' },
        { name: 'Ravioli Alfredo', price: 199, category: 'Pasta' },
        { name: 'Basil Pesto Pasta', price: 229, category: 'Pasta' },
        { name: 'Creamy Fusion Pasta', price: 179, category: 'Pasta' },

        // Signature Dishes
        { name: 'Bird Nest', price: 169, category: 'Signature Dishes' },
        { name: 'Cheese Filled Pasta', price: 229, category: 'Signature Dishes' },
        { name: 'Paneer Steak Bowl', price: 249, category: 'Signature Dishes' },
        { name: 'Chicken Steak Bowl', price: 299, category: 'Signature Dishes' },
        { name: 'Chicken Meat Balls', price: 299, category: 'Signature Dishes' },

        // Lunch Combos
        { name: 'Dal Tadka Rice', price: 99, category: 'Lunch Combos' },
        { name: 'Rajma Rice', price: 129, category: 'Lunch Combos' },
        { name: 'Chole Rice', price: 129, category: 'Lunch Combos' },
        { name: 'Chole Kulche', price: 129, category: 'Lunch Combos' },
        { name: 'Shahi Paneer Rice', price: 159, category: 'Lunch Combos' },

        // Indian Mains
        { name: 'Dal Makhani', price: 269, category: 'Indian Mains' },
        { name: 'Dal Tadka', price: 199, category: 'Indian Mains' },
        { name: 'Rajma', price: 199, category: 'Indian Mains' },
        { name: 'Chole', price: 199, category: 'Indian Mains' },
        { name: 'Kadahi Paneer', price: 269, category: 'Indian Mains' },
        { name: 'Shahi Paneer', price: 269, category: 'Indian Mains' },
        { name: 'Mix Veg', price: 269, category: 'Indian Mains' },

        // Rice/Bread
        { name: 'Steamed Rice', price: 99, category: 'Rice/Bread' },
        { name: 'Jeera Rice', price: 119, category: 'Rice/Bread' },
        { name: 'Matar Pulao', price: 129, category: 'Rice/Bread' },
        { name: 'Veg Briyani', price: 199, category: 'Rice/Bread' },
        { name: 'Tawa Roti', price: 12, category: 'Rice/Bread' },

        // Wraps & Rolls
        { name: 'Veg Delight Wrap', price: 99, category: 'Wraps & Rolls' },
        { name: 'Veg Keema Roll', price: 119, category: 'Wraps & Rolls' },
        { name: 'Pesto Veggie Wrap', price: 129, category: 'Wraps & Rolls' },
        { name: 'Paneer Tikka Wrap', price: 149, category: 'Wraps & Rolls' },
        { name: 'Paneer Fusion Wrap', price: 149, category: 'Wraps & Rolls' },
        { name: 'Paneer Kathi Roll', price: 149, category: 'Wraps & Rolls' },
        { name: 'Veg Kathi Roll', price: 149, category: 'Wraps & Rolls' },
        { name: 'Mushroom Kathi Roll', price: 149, category: 'Wraps & Rolls' },
        { name: 'Spicy Paneer Wrap', price: 149, category: 'Wraps & Rolls' },
        { name: 'Crispy Paneer Wrap', price: 169, category: 'Wraps & Rolls' },
        { name: 'Egg Wrap', price: 119, category: 'Wraps & Rolls' },
        { name: 'Egg Kathi Roll', price: 149, category: 'Wraps & Rolls' },
        { name: 'Masala Egg Wrap', price: 169, category: 'Wraps & Rolls' },
        { name: 'Chicken Kathi Roll', price: 179, category: 'Wraps & Rolls' },
        { name: 'Tangy Chicken Wrap', price: 179, category: 'Wraps & Rolls' },
        { name: 'Peri Peri Chicken Wrap', price: 189, category: 'Wraps & Rolls' },

        // Dips & Sauces
        { name: 'Thousand Island Sauce', price: 25, category: 'Dips & Sauces' },
        { name: 'Tartar Sauce', price: 25, category: 'Dips & Sauces' },
        { name: 'Sriracha Sauce', price: 45, category: 'Dips & Sauces' },
        { name: 'Honey Lemon Dip', price: 25, category: 'Dips & Sauces' },
        { name: 'Cheese Smoked Dip', price: 35, category: 'Dips & Sauces' },
        { name: 'Cheese and Garlic Dip', price: 35, category: 'Dips & Sauces' },

        // Thalis
        { name: 'Deluxe Thali', price: 269, category: 'Thalis', description: 'Dal Makhani, Sahi Paneer, MixVeg, Rice, 2 Chapatis, Salad, Raita, Desert' },
        { name: 'Executive Thali', price: 189, category: 'Thalis', description: 'Dal Tadka, MixVeg, Rice, 2 Chapatis, Salad, Raita' },

        // Comfort Cup
        { name: 'Espresso Shot', price: 129, category: 'Comfort Cup' },
        { name: 'Americano', price: 149, category: 'Comfort Cup' },
        { name: 'Cappuccino', price: 159, category: 'Comfort Cup' },
        { name: 'Café Latte', price: 169, category: 'Comfort Cup' },
        { name: 'Café Mocha', price: 169, category: 'Comfort Cup' },
        { name: 'Cortado', price: 169, category: 'Comfort Cup' },
        { name: 'Spanish Latte', price: 179, category: 'Comfort Cup' },
        { name: 'Cinnamon Cappuccino', price: 179, category: 'Comfort Cup' },
        { name: 'Irish Coffee', price: 179, category: 'Comfort Cup' },
        { name: 'Vietnamese Coffee', price: 179, category: 'Comfort Cup' },

        // Chai
        { name: 'Desi Chai', price: 49, category: 'Chai' },
        { name: 'Green Tea', price: 59, category: 'Chai' },
        { name: 'Ginger Tea', price: 79, category: 'Chai' },
        { name: 'Chamomile Tea', price: 79, category: 'Chai' },
        { name: 'Lemon Tea', price: 89, category: 'Chai' },
        { name: 'Masala Chai', price: 99, category: 'Chai' },
        { name: 'Butterfly Pea Tea', price: 99, category: 'Chai' },
        { name: 'Iced Lemon Tea', price: 99, category: 'Chai' },

        // Cold Cups
        { name: 'Affogato', price: 159, category: 'Cold Cups' },
        { name: 'Iced Americano', price: 159, category: 'Cold Cups' },
        { name: 'Iced Coffee Delight', price: 169, category: 'Cold Cups' },
        { name: 'Orange Brew', price: 169, category: 'Cold Cups' },
        { name: 'Ice Cinnamon Soya Latte', price: 179, category: 'Cold Cups' },
        { name: 'Iced Vietnamese', price: 179, category: 'Cold Cups' },
        { name: 'Vanilla Cold Coffee', price: 189, category: 'Cold Cups' },
        { name: 'Choco Chip Frappe', price: 189, category: 'Cold Cups' },
        { name: 'Roasted Hazelnut Ice Coffee', price: 189, category: 'Cold Cups' },

        // Mocktail
        { name: 'Virgin Mojito / Mint Cooler', price: 109, category: 'Mocktail' },
        { name: 'Mint Lemonade', price: 119, category: 'Mocktail' },
        { name: 'Blue Lagoon Cooler', price: 149, category: 'Mocktail' },
        { name: 'Fruit Punch Refresher', price: 179, category: 'Mocktail' },
        { name: 'Strawberry Cooler', price: 179, category: 'Mocktail' },

        // Pizza
        { name: 'Margherita Pizza', price: 99, category: 'Pizza' },
        { name: 'Farmhouse Pizza', price: 149, category: 'Pizza' },
        { name: 'Veggie Overload Pizza', price: 179, category: 'Pizza' },
        { name: 'Paneer Supreme Pizza', price: 199, category: 'Pizza' },
        { name: 'Chicken Pepperoni Pizza', price: 229, category: 'Pizza' },
        { name: 'Spiced Chicken Pizza', price: 229, category: 'Pizza' },

        // Fusion Snacks & Sides
        { name: 'Loaded Chaat Style Fries', price: 59, category: 'Fusion Snacks & Sides' },
        { name: 'Loaded Creamy Fries Supreme', price: 79, category: 'Fusion Snacks & Sides' },
        { name: 'Masala Corn Cheese Shots', price: 79, category: 'Fusion Snacks & Sides' },
        { name: 'Korean Classic Fries', price: 79, category: 'Fusion Snacks & Sides' },
        { name: 'Cheese Burst Bites', price: 99, category: 'Fusion Snacks & Sides' },
        { name: 'Cheesy Garlic Bread', price: 99, category: 'Fusion Snacks & Sides' },
        { name: 'Tomato Bruschetta', price: 99, category: 'Fusion Snacks & Sides' },
        { name: 'Spiced Potato Croquettes', price: 119, category: 'Fusion Snacks & Sides' },
        { name: 'Cheesy Jalapeño Bites', price: 149, category: 'Fusion Snacks & Sides' },
        { name: 'Loaded Paneer Nachos', price: 199, category: 'Fusion Snacks & Sides' },
        { name: 'Peri Peri Paneer Pops', price: 219, category: 'Fusion Snacks & Sides' },
        { name: 'Crispy Chicken Popcorn Bites', price: 199, category: 'Fusion Snacks & Sides' },
        { name: 'Spiced Chicken Nuggets', price: 199, category: 'Fusion Snacks & Sides' },
        { name: 'Chicken & Cheese Loaded Fries', price: 219, category: 'Fusion Snacks & Sides' },
        { name: 'Chicken Wings', price: 259, category: 'Fusion Snacks & Sides' },
        { name: 'Sriracha Chicken Wings', price: 269, category: 'Fusion Snacks & Sides' },
        { name: 'White Velvet Chicken Wings', price: 269, category: 'Fusion Snacks & Sides' },
        { name: 'Barbeque Chicken Wings', price: 269, category: 'Fusion Snacks & Sides' },

        // Salad
        { name: 'Casear Salad', price: 129, category: 'Salad' },
        { name: 'Russian Salad', price: 179, category: 'Salad' },
        { name: 'Garden Green Salad', price: 199, category: 'Salad' },
        { name: 'Roasted Veggies Quinoa Salad', price: 249, category: 'Salad' },
        { name: 'Paneer/Tofu Ranch Salad', price: 249, category: 'Salad' },
        { name: 'Cottage Cheese Caesar Salad', price: 249, category: 'Salad' },
        { name: 'Caprese Salad', price: 219, category: 'Salad' },
        { name: 'Sprouts Fruits and Nuts', price: 249, category: 'Salad' },
        { name: 'Pan-Grilled Vegetable Herbed Salad', price: 259, category: 'Salad' },
        { name: 'Avocado (Corn/Mango) Bean Salad', price: 269, category: 'Salad' },
        { name: 'Grilled Chicken Salad', price: 299, category: 'Salad' },
        { name: 'Chicken Caesar Salad', price: 159, category: 'Salad' },

        // Shakes
        { name: 'Vanilla Shake', price: 149, category: 'Shakes' },
        { name: 'Oreo Shake', price: 159, category: 'Shakes' },
        { name: 'Chocolate Shake', price: 179, category: 'Shakes' },
        { name: 'Strawberry Shake', price: 189, category: 'Shakes' },
        { name: 'Mango Shake', price: 189, category: 'Shakes' },
        { name: 'Nutella Shake', price: 199, category: 'Shakes' },
        { name: 'Biscoff Shake', price: 199, category: 'Shakes' },
        { name: 'Mocha Brownie Shake', price: 199, category: 'Shakes' },

        // Sandwich
        { name: 'Desi Vibes Sandwich', price: 59, category: 'Sandwich' },
        { name: 'Coleslaw Sandwich', price: 59, category: 'Sandwich' },
        { name: 'Peri Peri Potato Smash Sandwich', price: 59, category: 'Sandwich' },
        { name: 'Curd Sandwich', price: 89, category: 'Sandwich' },
        { name: 'Club Sandwich', price: 89, category: 'Sandwich' },
        { name: 'Classic Veggie Toastie Deluxe', price: 89, category: 'Sandwich' },
        { name: 'Spinach Corn Sandwich', price: 89, category: 'Sandwich' },
        { name: 'Garden Melt Sandwich', price: 99, category: 'Sandwich' },
        { name: 'Mediterranean Focaccia Sandwich', price: 99, category: 'Sandwich' },
        { name: 'Pesto Paneer Sandwich', price: 109, category: 'Sandwich' },
        { name: 'Guacamole Sandwich', price: 229, category: 'Sandwich' },
        { name: 'Mushroom Toast', price: 229, category: 'Sandwich' },
        { name: 'Chicken Meltwich', price: 99, category: 'Sandwich' },
        { name: 'Creamy Chicken Grilled Sandwich', price: 99, category: 'Sandwich' },
        { name: 'Chicken Club Sandwich', price: 109, category: 'Sandwich' },
        { name: 'Cheesy Keema Lava Sandwich', price: 109, category: 'Sandwich' },

        // Burger
        { name: 'Spiced Potato Slider Burger', price: 49, category: 'Burger' },
        { name: 'Cottage Cheese Fusion Slider', price: 99, category: 'Burger' },
        { name: 'Cheese Burst Burger', price: 99, category: 'Burger' },
        { name: 'Cottage Cheese Burger', price: 99, category: 'Burger' },
        { name: 'Mushroom Burger', price: 129, category: 'Burger' },
        { name: 'Cottage Cheese Supreme Burger', price: 129, category: 'Burger' },
        { name: 'Chicken Burger', price: 119, category: 'Burger' },
        { name: 'Crispy Chicken Burger', price: 129, category: 'Burger' },
        { name: 'Spicy Chicken Crunch Burger', price: 129, category: 'Burger' },

        // Evening Snacks
        { name: 'Samosa (1 Pc.)', price: 25, category: 'Evening Snacks' },
        { name: 'Bread Pakora (1 Pc.)', price: 25, category: 'Evening Snacks' },
        { name: 'Veg Cutlet (2 Pcs.)', price: 35, category: 'Evening Snacks' },
        { name: 'Paneer Cutlet (2 Pcs.)', price: 69, category: 'Evening Snacks' },
        { name: 'Paneer Momos (Steamed/Fried/Kurkure)', price: 89, category: 'Evening Snacks' },
        { name: 'Veg Momos (Steamed/Fried/Kurkure)', price: 69, category: 'Evening Snacks' },
        { name: 'Spinach Cigars', price: 119, category: 'Evening Snacks' },
        { name: 'Veg Cigars', price: 119, category: 'Evening Snacks' },
        { name: 'Crispy Paneer', price: 129, category: 'Evening Snacks' },
        { name: 'Mushroom Duplex', price: 249, category: 'Evening Snacks' },
        { name: 'Chicken Cigars', price: 179, category: 'Evening Snacks' },
    ];
    
    await prisma.menuItem.deleteMany({});
    for (const item of menuItems) {
        await prisma.menuItem.create({ data: item });
    }
    console.log(`  ✅ Menu items: ${menuItems.length} created`);

    // ── 3. Sample deal ──
    const now = new Date();
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    await prisma.deal.deleteMany({});
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
    console.log('\\n🌿 Seed complete!\\n');
    console.log('  Login credentials (all):');
    console.log('    Password: forcoamore');
    console.log('    Developer: dev@forcoamore.com');
    console.log('    Admin:     admin@forcoamore.com');
    console.log('    Kitchen:   kitchen@forcoamore.com');
    console.log('    Delivery:  delivery@forcoamore.com\\n');
}

seed()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
