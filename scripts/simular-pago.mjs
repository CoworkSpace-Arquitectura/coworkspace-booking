import { Redis } from 'ioredis';

const [bookingId, result] = process.argv.slice(2);
if (!bookingId || !['ok', 'fail'].includes(result)) {
  console.log('Uso: node --env-file=.env scripts/simular-pago.mjs <bookingId> ok|fail');
  process.exit(1);
}

const event = result === 'ok' ? 'billing.charge.succeeded' : 'billing.charge.failed';
const data = result === 'ok' ? { bookingId } : { bookingId, reason: 'Pago rechazado (simulado)' };

const redis = new Redis(process.env.REDIS_URL);
await redis.publish(event, JSON.stringify({ event, occurredAt: new Date().toISOString(), data }));
console.log(`Publicado ${event} para la reserva ${bookingId}`);
await redis.quit();