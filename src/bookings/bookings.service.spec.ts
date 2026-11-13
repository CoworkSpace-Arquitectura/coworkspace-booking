import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { BookingsService } from './bookings.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EventsService } from '../events/events.service.js';
import type { SpaceClient } from './space.client.js';
import type { MembershipClient } from './membership.client.js';
import type { Actor } from '../common/actor.js';

const socio: Actor = { id: 'member-1', role: 'MEMBER' };
const gerente: Actor = { id: 'gerente-1', role: 'MANAGER' };

describe('BookingsService', () => {
  const tx = {
    resourceLock: { upsert: vi.fn(), updateMany: vi.fn() },
    booking: { findFirst: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    booking: { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  };
  const events = { publish: vi.fn() };
  const space = { getResource: vi.fn(), getLocation: vi.fn() };
  const membership = { getActiveSubscription: vi.fn() };
  let service: BookingsService;

  const dto = (resourceType: ResourceType = ResourceType.DESK) => ({
    memberId: 'member-1',
    resourceId: 'resource-1',
    resourceType,
    startTime: '2030-01-15T14:00:00.000Z',
    endTime: '2030-01-15T16:00:00.000Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BookingsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
      space as unknown as SpaceClient,
      membership as unknown as MembershipClient,
    );
    membership.getActiveSubscription.mockResolvedValue({ id: 'sub-1', plan: { name: 'Solo puestos', resourceAccess: ['DESK'] } });
    space.getResource.mockResolvedValue({
      id: 'resource-1',
      locationId: 'location-1',
      hourlyRate: 30000,
      location: { name: 'Sede Centro', city: 'Montería', country: 'CO', currency: 'COP', managerId: 'gerente-1' },
    });
    tx.resourceLock.upsert.mockResolvedValue({ resourceId: 'resource-1', version: 3 });
    tx.booking.findFirst.mockResolvedValue(null);
    tx.booking.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'booking-1', ...data }),
    );
    tx.resourceLock.updateMany.mockResolvedValue({ count: 1 });
  });

  it('confirma sin cargo una reserva incluida en el plan y publica booking.created', async () => {
    await service.create(socio, dto(ResourceType.DESK));

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'CONFIRMED', extraCharge: 0, locationId: 'location-1' }),
    });
    expect(events.publish).toHaveBeenCalledWith(
      'booking.created',
      expect.objectContaining({ bookingId: 'booking-1', status: 'CONFIRMED' }),
    );
  });

  it('deja en PENDING_PAYMENT con cargo adicional una reserva fuera del plan', async () => {
    await service.create(socio, dto(ResourceType.ROOM));

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING_PAYMENT', extraCharge: 60000 }),
    });
  });

  it('rechaza con 409 un horario que se cruza con otra reserva', async () => {
    tx.booking.findFirst.mockResolvedValue({ id: 'otra-reserva' });

    await expect(service.create(socio, dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la versión del recurso cambió (bloqueo optimista)', async () => {
    tx.resourceLock.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create(socio, dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.resourceLock.updateMany).toHaveBeenCalledWith({
      where: { resourceId: 'resource-1', version: 3 },
      data: { version: { increment: 1 } },
    });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si la hora de fin no es posterior a la de inicio', async () => {
    const invalid = { ...dto(), endTime: '2030-01-15T13:00:00.000Z' };

    await expect(service.create(socio, invalid)).rejects.toBeInstanceOf(BadRequestException);
    expect(membership.getActiveSubscription).not.toHaveBeenCalled();
  });

  it('no consulta a Space ni reserva si el miembro no tiene membresía activa', async () => {
    membership.getActiveSubscription.mockRejectedValue(new ForbiddenException());

    await expect(service.create(socio, dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(space.getResource).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

    it('usa la tarifa y la moneda de la sede para el cargo adicional', async () => {
    space.getResource.mockResolvedValue({
      id: 'resource-1',
      locationId: 'location-mx',
      hourlyRate: 350,
      location: { name: 'Sede Polanco', city: 'Ciudad de México', country: 'MX', currency: 'MXN' },
    });

    await service.create(socio, dto(ResourceType.ROOM));

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ extraCharge: 700, currency: 'MXN' }),
    });
  });

  it('confirma la reserva cuando el pago es aprobado', async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    const confirmed = await service.confirmPayment('booking-1');

    expect(confirmed).toBe(true);
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('libera la reserva y publica booking.cancelled cuando el pago es rechazado', async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      memberId: 'member-1',
      resourceId: 'resource-1',
      startTime: new Date('2030-01-15T14:00:00.000Z'),
    });

    await service.releaseForFailedPayment('booking-1', 'Tarjeta rechazada');

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });
    expect(events.publish).toHaveBeenCalledWith(
      'booking.cancelled',
      expect.objectContaining({ bookingId: 'booking-1', reason: 'PAYMENT_REJECTED' }),
    );
  });

  it('guarda quién hizo la reserva (bookedBy)', async () => {
    await service.create(socio, dto());

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 'member-1', bookedBy: 'member-1' }),
    });
  });

  it('un socio no puede reservar a nombre de otra persona (403)', async () => {
    await expect(service.create(socio, { ...dto(), memberId: 'otro-socio' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(membership.getActiveSubscription).not.toHaveBeenCalled();
  });

  it('un gerente reserva a nombre de un cliente en una sede a su cargo', async () => {
    await service.create(gerente, dto());

    expect(membership.getActiveSubscription).toHaveBeenCalledWith('member-1');
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 'member-1', bookedBy: 'gerente-1' }),
    });
  });

  it('un gerente no reserva para clientes en una sede ajena (403)', async () => {
    const otroGerente: Actor = { id: 'gerente-2', role: 'MANAGER' };

    await expect(service.create(otroGerente, dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un socio solo ve sus reservas aunque pida las de otro', async () => {
    prisma.booking.findMany.mockResolvedValue([]);

    await service.findAll(socio, { memberId: 'otro-socio' });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { memberId: 'member-1' } }),
    );
  });

  it('un gerente no puede listar las reservas de una sede ajena', async () => {
    space.getLocation.mockResolvedValue({ id: 'location-9', managerId: 'gerente-2' });

    await expect(service.findAll(gerente, { locationId: 'location-9' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });
});
