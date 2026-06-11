-- Add cafe points (rewards) to users
ALTER TABLE "users" ADD COLUMN "cafe_points" INTEGER NOT NULL DEFAULT 0;

-- Add points earned/redeemed per order
ALTER TABLE "orders" ADD COLUMN "points_earned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0;
