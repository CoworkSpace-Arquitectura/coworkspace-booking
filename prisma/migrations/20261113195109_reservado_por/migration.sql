-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "booked_by" TEXT;

-- CreateIndex
CREATE INDEX "bookings_location_id_idx" ON "bookings"("location_id");
