import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export async function clubOrders(orderIds, tableNumber) {
    if (!orderIds || orderIds.length === 0) {
        throw new Error('No order IDs provided.');
    }

    const orders = await prisma.order.findMany({
        where: {
            id: { in: orderIds },
            tableNumber: tableNumber,
            orderType: 'DINE_IN',
            paymentMethod: 'COUNTER',
            status: { notIn: ['completed', 'cancelled'] }
        }
    });

    if (orders.length !== orderIds.length) {
        throw new Error('One or more orders are not valid for clubbing.');
    }

    const billId = uuidv4();

    await prisma.order.updateMany({
        where: {
            id: { in: orderIds }
        },
        data: {
            billId: billId
        }
    });

    return billId;
}

export async function completeBill(billId) {
    if (!billId) {
        throw new Error('No bill ID provided.');
    }

    const ordersToComplete = await prisma.order.findMany({
        where: {
            billId: billId,
            status: { notIn: ['completed', 'cancelled'] }
        }
    });

    if (ordersToComplete.length === 0) {
        throw new Error('No valid orders found for this bill.');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        for (const order of ordersToComplete) {
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: 'completed',
                    paidAt: now
                }
            });
        }
    });
}
