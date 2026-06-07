import fetch from 'node-fetch';

const FORCO_AMORE_PORT = 3089;
const CAFETERIA_GREEN_PORT = 3088;

const forcoAmoreRoutes = [
  '/',
  '/admin',
  '/customer',
  '/delivery',
  '/developer',
  '/kitchen',
  '/health',
  '/api/v1/menu',
];

const cafeteriaGreenRoutes = [
  '/',
  '/admin',
  '/customer',
  '/delivery',
  '/developer',
  '/kitchen',
  '/health',
  '/api/v1/menu',
];

async function checkRoutes(baseUrl, routes) {
  console.log(`Checking routes for ${baseUrl}`);
  for (const route of routes) {
    const url = `${baseUrl}${route}`;
    try {
      const response = await fetch(url);
      console.log(`[${response.status}] ${url}`);
    } catch (error) {
      console.error(`[ERROR] ${url} - ${error.message}`);
    }
  }
  console.log('');
}

(async () => {
  await checkRoutes(`http://localhost:${FORCO_AMORE_PORT}`, forcoAmoreRoutes);
  await checkRoutes(`http://localhost:${CAFETERIA_GREEN_PORT}`, cafeteriaGreenRoutes);
})();
