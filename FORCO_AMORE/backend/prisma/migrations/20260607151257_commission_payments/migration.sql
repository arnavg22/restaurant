-- CreateEnum
CREATE TYPE "CommissionPaymentStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "commission_payments" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "upi_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "note" TEXT,
    "status" "CommissionPaymentStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id")
);
