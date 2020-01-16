/**
 * Generic webhook channel class where `receive` and `respond` methods
 * should be overloaded by a child implementation.
 */
class ChannelAbstract {
  constructor() {

  }

  /**
   * receive message from the channel and resolve 
   * @param {express.Request} req 
   * @param {express.Response} res 
   * @return {Promise<any>} - Resolved message for IBCS
   */
  receive(req, res) {
    return Promise.reject(new Error('Channel receiver must be implemented'));
  }

  /**
   * respond to the channel with message from Bot
   * @param {object} message - Bot response payload
   * @param {express.Response} res 
   * @return {Promise<void>} - Resolve when done
   */
  respond(message, res) {
    return Promise.reject(new Error('Channel responder must be implemented'));
  }

  /**
   * transform channel message format to Oracle Bot
   * @param {*} channelMessage - message received by client channel
   * @return {object} - Oracle Bot message
   */
  _toBotPayload(channelMessage) {
    return {};
  }

  /**
   * transform bot message to channel format.
   * @param {object} botMessage 
   * @return {*} - Channel specific message format
   */
  _toChannelPayload(botMessage) {
    return {};
  }

}

module.exports = {
  ChannelAbstract,
}