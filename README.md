# CoworkSpace · Booking Service

![CI-CD](https://github.com/CoworkSpace-Arquitectura/coworkspace-booking/actions/workflows/deploy.yml/badge.svg)

Microservicio de reservas de salas y puestos. Usa bloqueo optimista para evitar dobles reservas, consulta a Space y Membership por REST y participa en la Saga de pago con Billing.

- **Despliegue:** https://coworkspace-booking.onrender.com
- **Documentación de la API (Swagger):** https://coworkspace-booking.onrender.com/docs
- **Puerto local:** 3004
- **Depende de:** Space Service, Membership Service (REST) y Redis (eventos)
- **Prueba de concurrencia:** `node scripts/prueba-concurrencia.mjs <memberId> <deskId>`

## Tecnologías

TypeScript, NestJS 12 y Node.js 24, Prisma 6 y PostgreSQL, Redis (ioredis) para eventos, Vitest y Supertest para pruebas, prom-client para métricas y @nestjs/swagger para la documentación. Se empaqueta con Docker.

## Instalación y ejecución local

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
npx prisma migrate dev          # crea las tablas en tu base local
npm run start:dev           # http://localhost:3004
```

Producción: `npm run build` y `node dist/main.js` (o la imagen Docker del `Dockerfile`).

## Variables de entorno

Están en `.env.example`. El archivo `.env` real no se sube al repositorio (está en `.gitignore`); en Render se configuran como variables de entorno y en GitHub Actions como *secrets*.

| Variable | Para qué sirve | Ejemplo |
| --- | --- | --- |
| `DATABASE_URL` | Base de datos PostgreSQL del servicio (en producción: Neon) | `postgresql://postgres:postgres@localhost:5432/coworkspace_booking` |
| `PORT` | Puerto HTTP | `3004` |
| `REDIS_URL` | Bus de eventos (en producción: Upstash Redis) | `redis://localhost:6379` |
| `SPACE_URL` | Servicios que consulta antes de reservar | `http://localhost:3001` |
| `MEMBERSHIP_URL` | Servicios que consulta antes de reservar | `http://localhost:3002` |

## Base de datos

- PostgreSQL propio del servicio (en producción, una base en Neon). Ningún otro servicio accede a ella.
- Esquema en `prisma/schema.prisma` y 3 migraciones versionadas en `prisma/migrations/`.
- Las migraciones se aplican solas al arrancar el contenedor (`npx prisma migrate deploy`); en local: `npx prisma migrate dev`.
- Datos de ejemplo: las peticiones de `requests.http`, `saga.http` (extensión REST Client de VS Code) crean datos de prueba.
- Respaldo: Neon permite restaurar la base a un punto anterior desde su panel.

## Endpoints

| Método | Ruta |
| --- | --- |
| POST | `/bookings` |
| GET | `/bookings` |
| GET | `/bookings/availability` |
| GET | `/bookings/:id` |
| PATCH | `/bookings/:id/cancel` |
| GET | `/internal/bookings` |
| GET | `/metrics` (métricas para Prometheus) |
| GET | `/docs` (Swagger UI) |

## Eventos (Redis Pub/Sub)

- **Publica:** `booking.created`, `booking.cancelled`
- **Escucha:** `billing.charge.succeeded`, `billing.charge.failed`

## Pruebas

Pruebas unitarias en `src/**/*.spec.ts` (con mocks de la base, de otros servicios y de las APIs externas) y una prueba de integración en `test/integration/` contra un PostgreSQL y un Redis reales.

```bash
npx vitest run --exclude "test/**"   # solo unitarias, sin base de datos
npm test                              # unitarias + integración (requiere DATABASE_URL y REDIS_URL)
npm run test:cov                      # con reporte de cobertura (carpeta coverage/)
```

En GitHub Actions las pruebas corren contra PostgreSQL 16 y Redis 7 reales, y el reporte de cobertura queda como artefacto `cobertura-booking`.

## CI/CD

`.github/workflows/deploy.yml` se ejecuta en cada push y pull request a `main` y llama al workflow reutilizable de [coworkspace-pipelines](https://github.com/CoworkSpace-Arquitectura/coworkspace-pipelines): lint, build, pruebas con cobertura → imagen Docker en GHCR → despliegue en Render. Si una prueba falla, no se construye la imagen ni se despliega. Los pull requests solo corren las pruebas.

## Monitoreo

`GET /metrics` expone métricas para Prometheus (peticiones por ruta y código, histograma de tiempos de respuesta y métricas del proceso). La configuración de Prometheus y el dashboard de Grafana están en `coworkspace-pipelines/monitoring`.
