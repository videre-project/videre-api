import morgan from 'morgan';
import chalk from 'chalk';
import { getNumberWithOrdinal } from 'utils/swiss';
import { API_DIR, parseRoute, crawlRoutes } from 'utils/routes';

const colors = {
    METHOD: {
    GET: '#61affe',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    POST: '#49cc90'
  },
  STATUS: {
    500: '#ffa200',
    400: '#ff5c5c',
    300: '#5271ff',
    200: '#35b729'
  }
}

export const morganMiddleware = morgan((tokens, req, res) => {
  const [dd, m, yyyy, time, tz] = tokens.date(req, res)
    .slice(5)
    .split(' ');
  const date = [
    m, getNumberWithOrdinal(dd), yyyy,
    '@',
    time
      .split(':')
      .map(x => ("00" + x).slice(-2))
      .join(':'),
    tz
  ].join(' ');

  const method = tokens.method(req, res);
  const methodColor = colors.METHOD?.[method] || '#ffffff';
  const apiMethod = (tokens.url(req, res))?.split('?')[0];

  const status = tokens.status(req, res);
  const statusColor = colors.STATUS?.[status.slice(0,1) + '00'] || '#ffffff';

  const responseTime = tokens['response-time'](req, res)

  const methodPadding = Math.max(...crawlRoutes(API_DIR).map(route =>
    parseRoute(route.slice(API_DIR.length)).length
  ));

  return chalk.hex('#000000')(
    chalk.yellow('[Logs] ') +
    [
      chalk.hex('#7E7E89')(date),
      chalk.bgHex(methodColor)(chalk.bold(` ${ method } `))
      + ' ' + chalk.hex(methodColor)(
        [apiMethod, new Array(1 + methodPadding).fill(',')]
          .join('')
          .replaceAll(',', ' ')
          .slice(0, methodPadding)
      ),
      chalk.bgHex(statusColor)(chalk.bold(` ${ status } `)),
      chalk.hex('#7E7E89')(`Took ${ chalk.hex('#2ed573')(responseTime) } ms`)
    ].join(chalk.hex('#7E7E89')(chalk.bold(' | ')))
  );
});