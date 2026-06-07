-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "assigned_delivery_id" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_delivery_id_fkey" FOREIGN KEY ("assigned_delivery_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
