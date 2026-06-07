-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DELIVERY', 'TAKEAWAY', 'DINE_IN');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'COUNTER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "tableNumber" TEXT,
ALTER COLUMN "delivery_name" DROP NOT NULL,
ALTER COLUMN "delivery_phone" DROP NOT NULL,
ALTER COLUMN "building_name" DROP NOT NULL,
ALTER COLUMN "floor_seat" DROP NOT NULL;
