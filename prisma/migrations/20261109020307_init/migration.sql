-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('DESK', 'ROOM');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'PENDING_PAYMENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_type" "ResourceType" NOT NULL,
    "location_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "extra_charge" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_locks" (
    "resource_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_locks_pkey" PRIMARY KEY ("resource_id")
);

-- CreateIndex
CREATE INDEX "bookings_resource_id_start_time_idx" ON "bookings"("resource_id", "start_time");

-- CreateIndex
CREATE INDEX "bookings_member_id_idx" ON "bookings"("member_id");
