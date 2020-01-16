const path = require('path');
const OracleBot = require('@oracle/bots-node-sdk');

const { ChannelAbstract } = require('./channel');
const Config = require('../config');
const { google, chat } = require('googleapis');

/**
 * Create a client auth against Google APIs
 * for a list of scopes. This requires service_account.json credentials as specified
 * in the `GOOGLE_APPLICATION_CREDENTIALS` environment variable.
 */
class GoogleServiceAuth {

  /**
   * Create new JWT auth client with scopes
   * @see https://developers.google.com/identity/protocols/googlescopes
   * @param {string[]} scopes - scopes to authorize
   */
  constructor(scopes) {
    const account = require(path.resolve(Config.get('GOOGLE_APPLICATION_CREDENTIALS')));
    const { client_email, private_key } = account;
    // auth client instance
    this._client = new google.auth.JWT(client_email, null, private_key, scopes);
  }

  /**
   * multi-use authorization promise
   * authorize the client token and resolve for use in googleapis.auth
   */
  authorize() {
    this.auth = this.auth || new Promise((resolve, reject) => {
      this._client.authorize((err, tokens) => err ? 
        reject(err) : 
        resolve(this._client));
    });
    return this.auth;
  }

}

/**
 * Implementation of google hangouts chat channel
 */
class HangoutsChatChannel extends ChannelAbstract {

  constructor() {
    super();
    // load Hangouts bot verifcation token
    this.verifyToken = Config.get('HANGOUTS_BOT_VERIFICATION_TOKEN');
    console.log("Verification"+Config.get('HANGOUTS_BOT_VERIFICATION_TOKEN'));
    // Use service account auth
    this.auth = new GoogleServiceAuth(['https://www.googleapis.com/auth/chat.bot']);
    // get chat api
    this.chat = google.chat('v1');

    // event types per https://developers.google.com/hangouts/chat/reference/message-formats/events
    this.events = {
      added: 'ADDED_TO_SPACE',
      removed: 'REMOVED_FROM_SPACE',
      message: 'MESSAGE',
      postback: 'CARD_CLICKED',
    };

    // icons corresponding to attachement types, etc
    this.icons = {
      file: 'DESCRIPTION',
      image: null, // different card type when image
      video: 'VIDEO_PLAY',
      audio: 'VIDEO_PLAY',
      location: 'MAP_PIN',
    };

    // action responses
    this.actionResponses = {
      updateMsg: 'UPDATE_MESSAGE',
      newMsg: 'NEW_MESSAGE',
    };
  }

  /**
   * receive message on hangouts webhook
   * @param {*} req 
   * @param {*} res 
   */
  receive(req, res) {
    return this._validate(req, res) // validate hangouts request
      .then(() => this._handleEvent(req, res)) // handle the event
      .then(message => this._toBotPayload(message)); // format for IBCS
  }

  /**
   * process bot reply and send to Hangouts
   * @param {*} message 
   * @param {*} res 
   */
  respond(message, res) {
    return Promise.resolve(this._toChannelPayload(message))
      .then(requestBody => {
        const { userId } = message;
        // space is captured in the userId because no additional details are sent back by default
        const parent = userId.match(/(spaces\/\w+)/)[1];
        return this.auth.authorize()
          .then(auth => {
            console.log('Sending to Hangouts...', JSON.stringify(requestBody, null, 2));
            // post chat message (reply) to the space
            return this.chat.spaces.messages.create({
              auth,
              requestBody,
              parent, // spaces/xyz...
            })
          })
          .then(() => console.log('Sent!'));
      });
  }

  _validate(req, res) {
    // validate the token property in the body matches the token we got from the
    // bot registration page.
    return new Promise((resolve, reject) => {
      const { token } = req.body;
      if (token === this.verifyToken) {
        console.log("First Token"+token);
        console.log("Second token"+this.verifyToken);
        resolve();
      } else {
        //resolve();

        res.status(403);
        reject(new Error(`Invalid token '${token}'`));
      }
    });
  }

  /**
   * Handle message event from Hangouts. Note that by rejecting(null), no message is sent to bot
   * @param {*} req - express request
   * @param {*} res - express response
   * @return {Promise<object>} - resolve the message object from Hangouts for event types.
   */
  _handleEvent(req, res) {
    const { type, message } = req.body;
    switch (type) {
      case this.events.postback:
        // a postback is an interactive action where Hangouts expects a synchronous response.
        // But, because the bot will respond asynchronously after postback is processed, those will
        // appear as new messages, so we must respond with a message update
        const updatedMessage = Object.assign({
          actionResponse: { type: this.actionResponses.updateMsg },
        }, message);
        res.send(updatedMessage);
        return Promise.resolve(req.body);
      case this.events.message:
        return Promise.resolve(req.body);
      // other types
      case this.events.added: // could send a greeting message
      case this.events.removed: // could say farewell message
      default:
        return Promise.reject(null); // doesn't send a message to bots
    }
  }

  /**
   * @see https://developers.google.com/hangouts/chat/reference/message-formats/events
   * @see https://developers.google.com/hangouts/chat/how-tos/cards-onclick for postback types
   * @param {*} body
   */
  _toBotPayload(body) {
    // extract message from user to bot
    const { user, space, action, message: { thread, argumentText } } = body;
    let names = user.displayName.split(' ');
    let firstName = names.shift(), lastName = names.join(' ');

    console.log("+user details+++++++++++++++++++++", JSON.stringify(user.email));

    const payload = {
      userId: [user.name, space.name].join('|'), // include space name in userId to capture in the receiver.
      messagePayload: null,
      profile: {
        space: space.name, // ultimately the webhook receiver should also receive this information to avoid userId manipulation.
        user: user.name,
        firstName,
        lastName,
      }
    };

    if (action) { // Postback
      const postback = JSON.parse(action.parameters[0].value);
      payload.messagePayload = OracleBot.Lib.MessageModel.postbackConversationMessage(postback);
    } else { // General message
      payload.messagePayload = OracleBot.Lib.MessageModel.textConversationMessage(argumentText.trim());
    }
    console.log('Sending to BOT', JSON.stringify(payload, null, 2));
    return payload;
  }

  /**
   * convert bot message to the appropriate channel payload
   * @see https://developers.google.com/hangouts/chat/reference/rest/v1/spaces.messages
   * @param {*} botMessage - response message from bot on webhook channel
   */
  _toChannelPayload(botMessage) {
    const { userId, messagePayload } = botMessage;
    const { type, actions, globalActions } = messagePayload;
    // console.log(`BOT -> ${userId}`, JSON.stringify(botMessage, null, 2));

    // determine channel presentation based on the message type
    let response = {};
    switch(type) {

      case 'text':
        const { text } = messagePayload;
        response.text = text;
        // actions must be presented as cards
        if (actions || globalActions) {
          let card = this._getCard();
          this._addCardActions(card, messagePayload);
          response.cards = [card];
        }
        break;

      case 'card':
        // reformat cards to google hangouts
        var cards = messagePayload.cards
          .map(card => {
            let c = this._getCard(card.title, card.description, card.imageUrl, card.url);
            this._addCardActions(c, card);
            return c;
          });
        // separate message actions and global actions into sections of a separate card
        if (actions || globalActions) {
          let card = this._getCard();
          this._addCardActions(card, messagePayload);
          cards.push(card);
        }
        response.cards = cards;
        break;

      case 'attachment':
        const { attachment } = messagePayload;
        var card = this._getCard(null, null, attachment.url); // defaults to image
        if (this.icons[attachment.type]) {
          card.sections = [{
            widgets: [{
              buttons: [
                {
                  imageButton: {
                    icon: this.icons[attachment.type],
                    onClick: { openLink: { url: attachment.url } }
                  }
                },
                {
                  textButton: {
                    text: 'OPEN',
                    onClick: { openLink: { url: attachment.url } }
                  }
                },
              ]
            }]
          }]
        }
        this._addCardActions(card, messagePayload);
        response.cards = [card];
        break;

      case 'location':
        const { location } = messagePayload;
        var card = this._getCard(location.title);
        card.sections.push({
          widgets: [{
            keyValue: {
              topLabel: 'Location',
              icon: this.icons.location,
              content: `${location.latitude}, ${location.longitude}`,
              onClick: location.url ? {openLink: {url: location.url}} : null,
            }
          }]
        });
        this._addCardActions(card, messagePayload);
        response.cards = [card];
        break;

      // raw
      default:
        response.text = `We received a response, but could format: ${JSON.stringify(messagePayload, null, 2)}`;
        break;
    }
    // return formatted payload
    return response;
  }

  /**
   * get a card for google hangouts
   * @param {string} title 
   * @param {string} subtitle 
   * @param {string} [imageUrl] 
   */
  _getCard(title, subtitle, imageUrl, url) {
    let sections = [];
    if (imageUrl) {
      sections.push({
        widgets: [{
          image: {
            imageUrl,
            onClick: (url ? { openLink: { url } } : null)
          }
        }]
      });
    }
    return {
      header: (title ? { title, subtitle, } : null),
      sections,
    };
  }

  /**
   * add buttons to a card based on messagePayload or card actions
   * @param {*} card - Google Hangouts card object
   * @param {*} messagePayload - message or Oracle Bot card
   * @return {void}
   */
  _addCardActions(card, messagePayload, title) {
    const { actions, globalActions } = messagePayload;
    [actions, globalActions]
      .filter(list => list && list.length)
      .map(list => this._actionsToButtons(list))
      .forEach(buttons => {
        card.sections.push({
         header: title ? title : null,
          widgets: [ {buttons} ]
        });
      })
  }

  /**
   * map actions to Google Hangouts Buttons
   * @see https://developers.google.com/hangouts/chat/reference/rest/v1/cards#button
   * @see https://developers.google.com/hangouts/chat/how-tos/cards-onclick#click_to_perform_app_action
   * @param {object[]} actions - IBCS actions
   * @return {object[]} - buttons 
   */
  _actionsToButtons(actions) {
    return actions.map(action => {
      const { type, label } = action;
      switch(type) {

        case 'postback':
          // create "interactive" button with postback action
          return {
            text: label,
            onClick: {
              action: {
                actionMethodName: 'postback',
                
                parameters: [{
                  
                  key: 'postback',
                  value: JSON.stringify(action.postback), // must be string
                }]
              }
            }
          };

        case 'url':
          return {
            text: label,
            onClick: { openLink: {url: action.url} }
          };

        case 'call':
          return {
            text: label,
            onClick: { openLink: {url: `tel:${action.phoneNumber}`} }
          };
      }
    })
    .filter(button => !!button) // remove unsupported actions
    .map(button => ({ textButton: button })) // finalize as 'textButton' type
  }

}

module.exports = {
  GoogleServiceAuth,
  HangoutsChatChannel,
}