import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { SpaceClient } from './space.client.js';
import { MembershipClient } from './membership.client.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import type { Actor } from '../common/actor.js';

export interface BookingFilters {
  memberId?: string;
  resourceId?: string;
  locationId?: string;
}

const ACTIVE_STATUSES = [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT];

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly space: SpaceClient,
    private readonly membership: MembershipClient,
  ) {}

  async create(actor: Actor, dto: CreateBookingDto) {
    // A nombre de quién: si no se indica, es para quien hace la petición.
    const memberId = dto.memberId ?? actor.id;
    const onBehalf = memberId !== actor.id;
    if (onBehalf && actor.role === 'MEMBER') {
      throw new ForbiddenException('Solo puedes hacer reservas a tu nombre');
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    }
    if (startTime <= new Date()) {
      throw new BadRequestException('No se puede reservar en el pasado');
    }

    const subscription = await this.membership.getActiveSubscription(memberId);
    const resource = await this.space.getResource(dto.resourceType, dto.resourceId);

    // Un gerente solo reserva a nombre de clientes en las sedes que tiene a cargo.
    if (onBehalf && actor.role === 'MANAGER' && resource.location.managerId !== actor.id) {
      throw new ForbiddenException('Solo puedes reservar para clientes en las sedes a tu cargo');
    }

    const includedInPlan = subscription.plan.resourceAccess.includes(dto.resourceType);
    const hours = (endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000);
    const extraCharge = includedInPlan ? 0 : Math.ceil(hours * resource.hourlyRate);
    const currency = resource.location.currency;

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
          memberId,
          bookedBy: actor.id,
          resourceId: dto.resourceId,
          resourceType: dto.resourceType,
          locationId: resource.locationId,
          startTime,
          endTime,
          extraCharge,
          currency,
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

    await this.events.publish('booking.created', {
      bookingId: booking.id,
      memberId: booking.memberId,
      bookedBy: booking.bookedBy,
      resourceId: booking.resourceId,
      resourceType: booking.resourceType,
      locationId: booking.locationId,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
      extraCharge: booking.extraCharge,
      currency: booking.currency,
    });

    return booking;
  }

  /**
   * Socio: solo sus reservas. Gerente: las suyas o las de una sede a su cargo (locationId).
   * Jefe: todas, con los filtros que quiera.
   */
  async findAll(actor: Actor, filters: BookingFilters = {}) {
    const where = { ...filters };
    if (actor.role === 'MEMBER') {
      where.memberId = actor.id;
    } else if (actor.role === 'MANAGER') {
      if (filters.locationId) {
        await this.ensureManages(actor, filters.locationId);
      } else {
        where.memberId = actor.id;
      }
    }
    return this.prisma.booking.findMany({ where, orderBy: { startTime: 'asc' } });
  }

  /** Lista sin filtros de permisos: solo la usa Analytics por la ruta interna. */
  findAllInternal() {
    return this.prisma.booking.findMany({ orderBy: { startTime: 'asc' } });
  }

  async findOne(actor: Actor, id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Reserva ${id} no encontrada`);
    }
    await this.ensureCanSee(actor, booking);
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

  async cancel(actor: Actor, id: string) {
    const booking = await this.findOne(actor, id);
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
      reason: actor.id === cancelled.memberId ? 'CANCELLED_BY_MEMBER' : 'CANCELLED_BY_STAFF',
      cancelledBy: actor.id,
    });
    return cancelled;
  }

  // Saga: el pago fue aprobado → se confirma la reserva
  async confirmPayment(bookingId: string) {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.PENDING_PAYMENT },
      data: { status: BookingStatus.CONFIRMED },
    });
    if (count === 0) {
      this.logger.warn(`La reserva ${bookingId} no estaba pendiente de pago`);
      return false;
    }
    this.logger.log(`Reserva ${bookingId} confirmada: pago aprobado`);
    return true;
  }

  // Saga: el pago fue rechazado → compensación, se libera la reserva
  async releaseForFailedPayment(bookingId: string, reason: string) {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.PENDING_PAYMENT },
      data: { status: BookingStatus.CANCELLED },
    });
    if (count === 0) {
      this.logger.warn(`La reserva ${bookingId} no estaba pendiente de pago`);
      return false;
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking) {
      await this.events.publish('booking.cancelled', {
        bookingId: booking.id,
        memberId: booking.memberId,
        resourceId: booking.resourceId,
        startTime: booking.startTime.toISOString(),
        reason: 'PAYMENT_REJECTED',
        detail: reason,
      });
    }
    this.logger.log(`Reserva ${bookingId} liberada: ${reason}`);
    return true;
  }

  /** El dueño de la reserva, el jefe o el gerente de la sede pueden verla y cancelarla. */
  private async ensureCanSee(actor: Actor, booking: { memberId: string; locationId: string }) {
    if (booking.memberId === actor.id || actor.role === 'OWNER') {
      return;
    }
    if (actor.role === 'MANAGER') {
      await this.ensureManages(actor, booking.locationId);
      return;
    }
    // A un socio no se le confirma que existe una reserva ajena.
    throw new NotFoundException('Reserva no encontrada');
  }

  private async ensureManages(actor: Actor, locationId: string) {
    const location = await this.space.getLocation(locationId);
    if (location.managerId !== actor.id) {
      throw new ForbiddenException('Esta sede no está a tu cargo');
    }
  }
}
