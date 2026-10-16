import { expect, it } from 'vitest';
import { GET } from './route';

it('reports application liveness without environment data or a database requirement', async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    status: 'ok',
    application: 'nextera-piscine',
    foundation: '001',
  });
});
