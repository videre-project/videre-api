/**
 * Config vars
 */
const config = {
  // Database connection string
  connectionString:
    process.env.DATABASE_URL || 'postgresql://postgres:videre@127.0.0.1:5432/postgres',
};

export default config;
