import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Documentación OpenAPI del servicio en /docs (JSON en /docs-json).
 * Las rutas se descubren de los controladores. En producción las peticiones llegan
 * desde el API Gateway, que agrega los encabezados x-member-id y x-member-role.
 */
export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CoworkSpace · Booking')
    .setDescription('Reservas de salas y puestos sin choques de horario. Publica booking.created y booking.cancelled.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-member-id' }, 'x-member-id')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-member-role' }, 'x-member-role')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.security = [{ 'x-member-id': [], 'x-member-role': [] }];
  SwaggerModule.setup('docs', app, document);
}
