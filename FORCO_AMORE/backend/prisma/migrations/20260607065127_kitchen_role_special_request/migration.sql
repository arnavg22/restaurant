-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'kitchen';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "special_request" TEXT;
