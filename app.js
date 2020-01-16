const express = require('express');
const morgan = require('morgan');
const OracleBot = require('@oracle/bots-node-sdk');
const Config = require('./config');
const { BotWebhookRouter } = require('./router');

const init = () => {
  const app = express();
  app.use(morgan('dev'));
  // serve static bot avatar
  app.use(express.static('static'));
  // initialize bot middleware
  OracleBot.init(app); // configure parser
  app.use(BotWebhookRouter.init()); // add routing
  return app;
}
module.exports = {
  init,
}
