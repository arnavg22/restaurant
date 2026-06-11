-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DELIVERY', 'TAKEAWAY', 'DINE_IN');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'COUNTER');

-- Add completed to OrderStatus enum
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'completed';

-- AlterTable: Add new columns to orders
ALTER TABLE "orders" ADD COLUMN "order_type" "OrderType" NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "orders" ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "orders" ADD COLUMN "table_number" TEXT;

-- Make delivery fields nullable (they were previously NOT NULL)
ALTER TABLE "orders" ALTER COLUMN "delivery_name" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "delivery_phone" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "building_name" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "floor_seat" DROP NOT NULL;
