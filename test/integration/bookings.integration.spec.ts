import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/setup-app.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SpaceClient } from '../../src/bookings/space.client.js';
import { MembershipClient } from '../../src/bookings/membership.client.js';

/**
 * Integración: crear reservas por HTTP con PostgreSQL real, incluida la regla
 * "no dos reservas en el mismo horario" (bloqueo optimista en la base de datos).
 * Space y Membership (otros microservicios) se sustituyen por dobles.
 */
describe('Reservas (integración con la base de datos)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const memberId = randomUUID();
  const resourceId = randomUUID();
  const locationId = randomUUID();
  const socio = { 'x-member-id': memberId, 'x-member-role': 'MEMBER' };
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MembershipClient)
      .useValue({ getActiveSubscription: () => Promise.resolve({ id: randomUUID(), plan: { name: 'Flex', resourceAccess: ['DESK'] } }) })
      .overrideProvider(SpaceClient)
      .useValue({
        getResource: () =>
          Promise.resolve({
            id: resourceId,
            locationId,
            hourlyRate: 30000,
            location: { name: 'Sede de prueba', city: 'Montería', country: 'CO', currency: 'COP', managerId: null },
          }),
        getLocation: () => Promise.resolve({ id: locationId, name: 'Sede de prueba', managerId: null }),
      })
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { memberId } });
    await prisma.resourceLock.deleteMany({ where: { resourceId } });
    await app.close();
  });

  it('crea una sala fuera del plan como pendiente de pago, con el cargo calculado', async () => {
    const res = await request(app.getHttpServer())
      .post('/bookings')
      .set(socio)
      .send({ resourceId, resourceType: 'ROOM', startTime: at(0), endTime: at(2) })
      .expect(201);

    expect(res.body).toMatchObject({ memberId, bookedBy: memberId, status: 'PENDING_PAYMENT', extraCharge: 60000, currency: 'COP' });
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(stored.locationId).toBe(locationId);
  });

  it('rechaza con 409 una segunda reserva que se cruza con el mismo horario', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .set(socio)
      .send({ resourceId, resourceType: 'ROOM', startTime: at(1), endTime: at(3) })
      .expect(409);

    const list = await request(app.getHttpServer()).get('/bookings').set(socio).expect(200);
    expect(list.body).toHaveLength(1);
  });
});
