import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

  @Get()
  findAll(@Query('memberId') memberId?: string, @Query('resourceId') resourceId?: string) {
    return this.bookingsService.findAll(memberId, resourceId);
  }

  @Get('availability')
  availability(
    @Query('resourceId', ParseUUIDPipe) resourceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookingsService.availability(resourceId, from, to);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancel(id);
  }
}