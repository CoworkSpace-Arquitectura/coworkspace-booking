import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { BookingsService } from './bookings.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EventsService } from '../events/events.service.js';
import type { SpaceClient } from './space.client.js';
import type { MembershipClient } from './membership.client.js';

describe('BookingsService', () => {
  const tx = {
    resourceLock: { upsert: vi.fn(), updateMany: vi.fn() },
    booking: { findFirst: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const events = { publish: vi.fn() };
  const space = { getResource: vi.fn() };
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
    space.getResource.mockResolvedValue({ id: 'resource-1', locationId: 'location-1' });
    tx.resourceLock.upsert.mockResolvedValue({ resourceId: 'resource-1', version: 3 });
    tx.booking.findFirst.mockResolvedValue(null);
    tx.booking.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'booking-1', ...data }),
    );
    tx.resourceLock.updateMany.mockResolvedValue({ count: 1 });
  });

  it('confirma sin cargo una reserva incluida en el plan y publica booking.created', async () => {
    await service.create(dto(ResourceType.DESK));

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'CONFIRMED', extraCharge: 0, locationId: 'location-1' }),
    });
    expect(events.publish).toHaveBeenCalledWith(
      'booking.created',
      expect.objectContaining({ bookingId: 'booking-1', status: 'CONFIRMED' }),
    );
  });

  it('deja en PENDING_PAYMENT con cargo adicional una reserva fuera del plan', async () => {
    await service.create(dto(ResourceType.ROOM));

    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING_PAYMENT', extraCharge: 60000 }),
    });
  });

  it('rechaza con 409 un horario que se cruza con otra reserva', async () => {
    tx.booking.findFirst.mockResolvedValue({ id: 'otra-reserva' });

    await expect(service.create(dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la versión del recurso cambió (bloqueo optimista)', async () => {
    tx.resourceLock.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create(dto())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.resourceLock.updateMany).toHaveBeenCalledWith({
      where: { resourceId: 'resource-1', version: 3 },
      data: { version: { increment: 1 } },
    });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si la hora de fin no es posterior a la de inicio', async () => {
    const invalid = { ...dto(), endTime: '2030-01-15T13:00:00.000Z' };

    await expect(service.create(invalid)).rejects.toBeInstanceOf(BadRequestException);
    expect(membership.getActiveSubscription).not.toHaveBeenCalled();
  });

  it('no consulta a Space ni reserva si el miembro no tiene membresía activa', async () => {
    membership.getActiveSubscription.mockRejectedValue(new ForbiddenException());

    await expect(service.create(dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(space.getResource).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});