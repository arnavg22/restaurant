-- Add a dedicated 'discount' role for the Discount Panel
-- (manages schemes, menu and per-item discounts).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'discount';
