const express = require('express');
const OracleBot = require('@oracle/bots-node-sdk');
const Config = require('./config');
const { HangoutsChatChannel } = require('./lib/google');

const [REQ_PARAM_CHANNEL] = ['channelName'];

/**
 * Implemented Client Channel
 * @typedef {ChannelAbstract} ChannelImplementation.
 */

/**
 * Extensible router for incoming/outgoing bot webhook messaging.
 * The router is designed to support any number of client channels on
 * the /bot/channel/:channelName endpoint.
 * @property {Map<string, ChannelImplementation>} channels - map of channelName, and ChannelAbstract extension
 */
class BotWebhookRouter {
  
  static init() {
    return new this().router;
  }

  constructor() {
    // instantiate webhook client
    const { WebhookClient } = OracleBot.Middleware;
    this.webhook = new WebhookClient({
      channel: this.channelConfig.bind(this),
    });

    // add request handlers
    this.router = express.Router();
    // add receiver for client(channel) messages
    this.router.post(`/bot/channel/:${REQ_PARAM_CHANNEL}`, this.client());
    // add IBCS webhook receiver
    this.router.post('/bot/webhook/receiver', this.receiver());

    // support multiple client channels, add others as necessary
    this.channels = new Map([
      ['hangouts', new HangoutsChatChannel()],
    ]);
  }

  /**
   * get webhook channel configuration 
   * @param {express.Request} req - express request object
   */
  channelConfig(req) {
    return {
      url: Config.get('ORACLE_WEBHOOK_URL'),
      secret: Config.get('ORACLE_WEBHOOK_SECRET')
    };
  }

  /**
   * Configure client middleware for sending messages to OracleBot.
   */
  client() {
    // return request handler
    return (req, res, next) => {
      const channelName = req.params[REQ_PARAM_CHANNEL];
      if (this.channels.has(channelName)) {
        console.log(`CLIENT MESSAGE '${channelName}'`, JSON.stringify(req.body, null, 2));
        // get the channel 
        this.channels.get(channelName)
          .receive(req, res)
          .then(result => this._spliceChannelIdentifier(channelName, result))
          .then(messageToBot => this.webhook.send(messageToBot, this.channelConfig(req))) // send to bot.
          .then(() => {
            // handle cases where the channel implementation does not respond to the client.
            if (!res.headersSent) {
              res.send(); // 200
            }
          })
          .catch(next);
      } else {
        const e = new Error(`Channel receiver '${channelName}' is not defined`);
        res.status(404).send(e.message);
      }
    };
  }

  /**
   * Oracle Bot outgoing webhook channel receiver.
   */
  receiver() {
    return this.webhook.receiver((req, res) => {
      // forward to channel
      const botResponse = req.body;
      const channelName = this._unspliceChannelIdentifier(botResponse) ;
      if (this.channels.has(channelName)) {
        console.log(`BOT MESSAGE '${channelName}'`, JSON.stringify(botResponse, null, 2));
        this.channels.get(channelName)
          .respond(botResponse, res)
          .then(() => res.send()) // Respond with 200 OK
          .catch(e => {
            console.error(e);
            res.status(500).send(e.message)
          }); // Error to bot webhook
      } else {
        res.status(404).send(`Channel responder'${channelName}' is not defined`);
      }
    });
  }

  /**
   * Splice the channel name into the userId in order to forward
   * bot responses to the appropriate channel implementation.
   * @param {*} channel 
   * @param {*} message 
   */
  _spliceChannelIdentifier(channel, message) {
    message.userId = `${channel}|${message.userId}`;
    return message;
  }

  /**
   * Remove previously spliced channel name from the userId
   * @param {*} message 
   */
  _unspliceChannelIdentifier(message) {
    const parts = message.userId.split('|');
    const channel = parts.shift();
    message.userId = parts.join('|');
    return channel;
  }

}

module.exports = {
  BotWebhookRouter,
}