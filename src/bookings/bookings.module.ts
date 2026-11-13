import { Module } from '@nestjs/common';
import { BookingsController, InternalBookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { SpaceClient } from './space.client.js';
import { MembershipClient } from './membership.client.js';
import { BillingEventsListener } from './billing-events.listener.js';

@Module({
  controllers: [BookingsController, InternalBookingsController],
  providers: [BookingsService, SpaceClient, MembershipClient, BillingEventsListener],
})
export class BookingsModule {}