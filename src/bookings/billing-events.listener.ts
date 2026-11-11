import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { BookingsService } from './bookings.service.js';

interface ChargeEvent {
  event: string;
  data: { bookingId: string; reason?: string };
}

@Injectable()
export class BillingEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingEventsListener.name);
  private subscriber?: Redis;

  constructor(private readonly bookings: BookingsService) {}

  onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.logger.warn('REDIS_URL no está configurado: no se escucharán eventos');
      return;
    }
    this.subscriber = new Redis(process.env.REDIS_URL);
    this.subscriber.on('message', (channel: string, message: string) => {
      void this.handle(channel, message);
    });
    this.subscriber
      .subscribe('billing.charge.succeeded', 'billing.charge.failed')
      .then(() => this.logger.log('Escuchando billing.charge.succeeded y billing.charge.failed'))
      .catch((error: Error) => this.logger.error(`No se pudo suscribir: ${error.message}`));
  }

  private async handle(channel: string, message: string) {
    try {
      const event = JSON.parse(message) as ChargeEvent;
      if (channel === 'billing.charge.succeeded') {
        await this.bookings.confirmPayment(event.data.bookingId);
      } else if (channel === 'billing.charge.failed') {
        await this.bookings.releaseForFailedPayment(event.data.bookingId, event.data.reason ?? 'Pago rechazado');
      }
    } catch (error) {
      this.logger.error(`Error procesando ${channel}: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }
}