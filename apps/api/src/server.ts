import { buildApp } from './app';
import { loadEnv } from './env';

// Boots without a database and without any secrets configured.
const env = loadEnv();
const port = env.PORT ?? 3001;

const app = buildApp();

app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exitCode = 1;
});
