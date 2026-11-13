const [memberId, deskId] = process.argv.slice(2);
if (!memberId || !deskId) {
  console.log('Uso: node scripts/prueba-concurrencia.mjs <memberId> <deskId>');
  process.exit(1);
}

const body = JSON.stringify({
  memberId,
  resourceId: deskId,
  resourceType: 'DESK',
  startTime: '2026-11-26T14:00:00.000Z',
  endTime: '2026-11-26T15:00:00.000Z',
});

console.log('Enviando 5 reservas simultáneas para el mismo puesto y horario...\n');

const results = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    fetch('http://localhost:3004/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Así llega cuando pasa por el Gateway: identidad del socio que reserva
        'X-Member-Id': memberId,
        'X-Member-Role': 'MEMBER',
      },
      body,
    }).then(async (res) => ({ intento: i + 1, status: res.status, body: await res.json() })),
  ),
);

for (const r of results) {
  const detalle = r.status === 201 ? `reserva ${r.body.id}` : r.body.message;
  console.log(`Intento ${r.intento}: ${r.status} → ${detalle}`);
}

const exitosas = results.filter((r) => r.status === 201).length;
console.log(`\nResultado: ${exitosas} reserva exitosa, ${results.length - exitosas} rechazadas.`);