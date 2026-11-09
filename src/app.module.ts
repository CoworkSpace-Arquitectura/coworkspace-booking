import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { BookingsModule } from './bookings/bookings.module.js';

@Module({
  imports: [PrismaModule, EventsModule, BookingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
