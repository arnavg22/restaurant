-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "section" TEXT NOT NULL DEFAULT 'Food',
ADD COLUMN     "variants" JSONB;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "variant" TEXT;
