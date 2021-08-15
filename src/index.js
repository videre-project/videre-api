import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import api from './api';

const PORT = process.env.PORT || 3000;

const server = express();

server.use('/api', cors(), helmet(), express.json(), morgan('dev'), api);

server.listen(PORT, error => {
  if (error) throw error;
  console.info(`Listening on port ${PORT}`);
});
