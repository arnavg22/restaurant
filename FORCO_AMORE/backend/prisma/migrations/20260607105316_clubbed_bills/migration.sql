-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bill_id" TEXT,
ADD COLUMN     "is_served" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "orders_bill_id_idx" ON "orders"("bill_id");
