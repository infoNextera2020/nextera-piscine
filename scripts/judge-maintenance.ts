import postgres from 'postgres';

if (!process.env.MAINTENANCE_DATABASE_URL) throw new Error('MAINTENANCE_DATABASE_URL required.');
const client = postgres(process.env.MAINTENANCE_DATABASE_URL, { max: 1, prepare: false });
try {
  const repeat = !process.argv.includes('--once');
  do {
    const [row] = await client`SELECT judge.recover_expired(100) AS recovered`;
    if (Number(row!.recovered))
      console.info(JSON.stringify({ event: 'expired_leases_recovered', count: row!.recovered }));
    if (process.argv.includes('--once')) break;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } while (repeat);
} finally {
  await client.end();
}
