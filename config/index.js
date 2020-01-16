const path = require('path');
const nconf = require('nconf');
const dotenv = require('dotenv');

dotenv.config();

function configOption(type, env) {
  return {
    type: 'file',
    file: configPath(type, env),
  };
}

function configPath(type, env) {
  let cPath = `${type}.json`;
  let suffix = env ? `_${env}` : '';
  let filename = `${type}${suffix}.json`;
  switch (type) {
  case 'app':
    cPath = path.join(__dirname, filename);
    break;
  }
  return path.resolve(cPath);
}

const env = process.env;
nconf.env()
  .add('appenv', configOption('app', env.NODE_ENV))  // env-specific app config
  .add('app', configOption('app')); // backfill defaults from base app.json

module.exports = nconf;