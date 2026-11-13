import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentActor, type Actor } from '../common/actor.js';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(actor, dto);
  }

  @Get()
  findAll(
    @CurrentActor() actor: Actor,
    @Query('memberId') memberId?: string,
    @Query('resourceId') resourceId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.bookingsService.findAll(actor, { memberId, resourceId, locationId });
  }

  /** Pública: solo devuelve horarios ocupados, sin datos de quién reservó. */
  @Get('availability')
  availability(
    @Query('resourceId', ParseUUIDPipe) resourceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookingsService.availability(resourceId, from, to);
  }

  @Get(':id')
  findOne(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(actor, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancel(actor, id);
  }
}

/**
 * Ruta interna para otros microservicios (Analytics). El Gateway solo enruta
 * /api/bookings -> /bookings, así que desde internet no se llega a /internal.
 */
@Controller('internal/bookings')
export class InternalBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  findAll() {
    return this.bookingsService.findAllInternal();
  }
}
