import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Router } from 'express';

const parseRoute = route =>
  route
    // Remove base path
    .replace(__dirname, '')
    // Make path web-safe
    .replace(/\\/g, '/')
    // Remove file extension
    .replace(/\.[^.]+$/, '')
    // Handle dynamic route
    .replace(/\[([^\]]+)\]/, ':$1')
    // Handle route index
    .replace('/index', '/');

const crawlRoutes = (path, routes = []) => {
  if (statSync(path).isDirectory()) {
    readdirSync(path).map(file => crawlRoutes(join(path, file), routes));
  } else if (path !== __filename) {
    routes.push(path);
  }

  return routes;
};

const routes = Router();

routes.use('/', (_, res) =>
  res.status(400).json({
    details:
      "No data is returned at this path. For more information about this API's published methods and objects, see https://videreproject.com/docs/api.",
  })
);

crawlRoutes(__dirname).forEach(route => {
  routes.use(parseRoute(route), require(route).default);
});

export default routes;
