# CoworkSpace · Booking Service

![CI-CD](https://github.com/CoworkSpace-Arquitectura/coworkspace-booking/actions/workflows/deploy.yml/badge.svg)

Microservicio de reservas de salas y puestos. Usa bloqueo optimista para evitar dobles reservas, consulta a Space y Membership por REST, y publica los eventos `booking.created` y `booking.cancelled`.

- **Endpoints:** `/bookings`, `/bookings/availability`, `/bookings/:id/cancel`
- **Puerto local:** 3004
- **Depende de:** Space Service, Membership Service (REST) y Redis (eventos)
- **Prueba de concurrencia:** `node scripts/prueba-concurrencia.mjs <memberId> <deskId>`