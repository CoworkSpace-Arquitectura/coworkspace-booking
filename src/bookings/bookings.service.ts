import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { SpaceClient } from './space.client.js';
import { MembershipClient } from './membership.client.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';

const HOURLY_RATE: Record<ResourceType, number> = {
  ROOM: 30000,
  DESK: 15000,
};

const ACTIVE_STATUSES = [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT];

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly space: SpaceClient,
    private readonly membership: MembershipClient,
  ) {}

  async create(dto: CreateBookingDto) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    }
    if (startTime <= new Date()) {
      throw new BadRequestException('No se puede reservar en el pasado');
    }

    // 1. Membership: ¿membresía activa? ¿el plan incluye este tipo de recurso?
    const subscription = await this.membership.getActiveSubscription(dto.memberId);
    // 2. Space: ¿existe el recurso? ¿en qué sede está?
    const resource = await this.space.getResource(dto.resourceType, dto.resourceId);

    const includedInPlan = subscription.plan.resourceAccess.includes(dto.resourceType);
    const hours = (endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000);
    const extraCharge = includedInPlan ? 0 : Math.ceil(hours * HOURLY_RATE[dto.resourceType]);

    // 3. Transacción con bloqueo optimista sobre el recurso
    const booking = await this.prisma.$transaction(async (tx) => {
      const lock = await tx.resourceLock.upsert({
        where: { resourceId: dto.resourceId },
        create: { resourceId: dto.resourceId },
        update: {},
      });

      const overlapping = await tx.booking.findFirst({
        where: {
          resourceId: dto.resourceId,
          status: { in: ACTIVE_STATUSES },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });
      if (overlapping) {
        throw new ConflictException('El recurso ya está reservado en ese horario');
      }

      const created = await tx.booking.create({
        data: {
          memberId: dto.memberId,
          resourceId: dto.resourceId,
          resourceType: dto.resourceType,
          locationId: resource.locationId,
          startTime,
          endTime,
          extraCharge,
          status: extraCharge > 0 ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
        },
      });

      const { count } = await tx.resourceLock.updateMany({
        where: { resourceId: dto.resourceId, version: lock.version },
        data: { version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConflictException('Otra persona reservó este recurso al mismo tiempo. Intenta de nuevo.');
      }

      return created;
    });

    // 4. Publicar el evento
    await this.events.publish('booking.created', {
      bookingId: booking.id,
      memberId: booking.memberId,
      resourceId: booking.resourceId,
      resourceType: booking.resourceType,
      locationId: booking.locationId,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
      extraCharge: booking.extraCharge,
    });

    return booking;
  }

  findAll(memberId?: string, resourceId?: string) {
    return this.prisma.booking.findMany({
      where: { memberId, resourceId },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Reserva ${id} no encontrada`);
    }
    return booking;
  }

  availability(resourceId: string, from?: string, to?: string) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return this.prisma.booking.findMany({
      where: {
        resourceId,
        status: { in: ACTIVE_STATUSES },
        startTime: { lt: end },
        endTime: { gt: start },
      },
      select: { startTime: true, endTime: true, status: true },
      orderBy: { startTime: 'asc' },
    });
  }

  async cancel(id: string) {
    const booking = await this.findOne(id);
    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException('La reserva ya está cancelada');
    }
    const cancelled = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED },
    });
    await this.events.publish('booking.cancelled', {
      bookingId: cancelled.id,
      memberId: cancelled.memberId,
      resourceId: cancelled.resourceId,
      startTime: cancelled.startTime.toISOString(),
      reason: 'CANCELLED_BY_MEMBER',
    });
    return cancelled;
  }
}