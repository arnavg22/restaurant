-- Per-item GST: admin sets/edits a GST rate (%) per menu item. Default 5%.
ALTER TABLE "menu_items" ADD COLUMN "gst_rate" DECIMAL(65,30) NOT NULL DEFAULT 5;

-- Allow menu items to be hard-deleted while preserving order history.
-- order_items.menu_item_id becomes nullable and the FK switches to ON DELETE SET NULL.
ALTER TABLE "order_items" ALTER COLUMN "menu_item_id" DROP NOT NULL;

ALTER TABLE "order_items" DROP CONSTRAINT "order_items_menu_item_id_fkey";

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey"
    FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
