-- Add per-item delivery availability flag.
-- Defaults to true (available for delivery/takeaway); Bar (alcohol) items default to false (dine-in only).
ALTER TABLE "menu_items" ADD COLUMN "delivery_available" BOOLEAN NOT NULL DEFAULT true;

-- Existing alcohol (Bar) items become dine-in only by default.
UPDATE "menu_items" SET "delivery_available" = false WHERE "section" = 'Bar';
