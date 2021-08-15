import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const API_DIR = join(__dirname, 'api');
const PORT = process.env.PORT || 3000;

const parseRoute = route =>
  route
    // Remove base path
    .replace(API_DIR, '')
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

const server = express();
server.use(cors());
server.use(helmet());
server.use(express.json());
server.use(morgan('dev'));

crawlRoutes(API_DIR).forEach(route => {
  server.all(parseRoute(route), require(route).default);
});

server.listen(PORT, error => {
  if (error) throw error;
  console.info(`Listening on port ${PORT}`);
});
