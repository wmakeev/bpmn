/**
 * Copyright: E2E Technologies Ltd
 */

'use strict';

/**
 * @param {BPMNProcess} bpmnProcess
 * @constructor
 */
var BPMNProcessClient = exports.BPMNProcessClient = function BPMNProcessClient(bpmnProcess) {
  this._implementation = bpmnProcess;
};

/**
 * @return {BPMNProcess}
 * @private
 */
BPMNProcessClient.prototype._getImplementation = function _getImplementation() {
  return this._implementation;
};

/**
 * @param {String} taskName
 * @param {Object} data
 */
BPMNProcessClient.prototype.taskDone = function taskDone(taskName, data) {
  this._getImplementation().taskDone(taskName, data);
};

/**
 * @param {String} eventName
 * @param {Object=} data
 */
BPMNProcessClient.prototype.triggerEvent = function triggerEvent(eventName, data) {
  this._getImplementation().triggerEvent(eventName, data);
};

/**
 * @param {BPMNMessageFlow} messageFlow
 * @param {Object=} data
 */
BPMNProcessClient.prototype.sendMessage = function sendMessage(messageFlow, data) {
  this._getImplementation().sendMessage(messageFlow, data);
};

/**
 * @param {String}sourceObjectFlowName
 * @return {Array.<BPMNMessageFlow>}
 */
BPMNProcessClient.prototype.getOutgoingMessageFlows = function getOutgoingMessageFlows(
  sourceObjectFlowName) {
  return this.getProcessDefinition().getMessageFlowsBySourceName(sourceObjectFlowName);
};

/**
 * @return {BPMNProcessState}
 */
BPMNProcessClient.prototype.getState = function getState() {
  return this._getImplementation().getState();
};

/**
 * @return {BPMNProcessHistory}
 */
BPMNProcessClient.prototype.getHistory = function getHistory() {
  return this._getImplementation().getHistory();
};

/**
 * @param {String} name
 * @param {Object} value
 */
BPMNProcessClient.prototype.setProperty = function setProperty(name, value) {
  this._getImplementation().setProperty(name, value);
};

/**
 * @param {String} name
 * @return {Object}
 */
BPMNProcessClient.prototype.getProperty = function getProperty(name) {
  return this._getImplementation().getProperty(name);
};

/**
 * @return {Object}
 */
BPMNProcessClient.prototype.getProperties = function getProperties() {
  return this._getImplementation().getProperties();
};

/**
 * @return {BPMNProcessClient}
 */
BPMNProcessClient.prototype.getParentProcess = function getParentProcess() {
  return this._getImplementation().getParentProcess().processClient;
};

/**
 * @return {BPMNProcessDefinition}
 */
BPMNProcessClient.prototype.getProcessDefinition = function getProcessDefinition() {
  return this._getImplementation().getProcessDefinition();
};

/**
 * @return {String}
 */
BPMNProcessClient.prototype.getProcessId = function getProcessId() {
  return this._getImplementation().getProcessId();
};

/**
 * @param {String} participantName
 * @param {Function} callback
 * @return {BPMNProcessClient}
 */
BPMNProcessClient.prototype.getParticipantByName = function getParticipantByName(participantName,
                                                                                 callback) {
  this._getImplementation().getParticipantByName(participantName,
    function handler(err, bpmnProcess) {
      if (err) {
        return callback(err);
      }

      return callback(null, bpmnProcess.processClient);
    });
};

/**
 * @param {Logger} logger
 */
BPMNProcessClient.prototype.setLogger = function setLogger(logger) {
  this._getImplementation().setLogger(logger);
};

/**
 * @param {number | string} logLevel
 */
BPMNProcessClient.prototype.setLogLevel = function setLogLevel(logLevel) {
  this._getImplementation().setLogLevel(logLevel);
};

/**
 * Add winston log transport (semantic like winston add() [https://github.com/flatiron/winston])
 * @param winstonTransport
 * @param options
 */
BPMNProcessClient.prototype.addLogTransport = function addLogTransport(winstonTransport, options) {
  this._getImplementation().addLogTransport(winstonTransport, options);
};

/**
 * Remove winston log transport (semantic like winston remove() [https://github.com/flatiron/winston])
 * @param winstonTransport
 */
BPMNProcessClient.prototype.removeLogTransport = function removeLogTransport(winstonTransport) {
  this._getImplementation().removeLogTransport(winstonTransport);
};

/**
 * @param {function(string)} logAppender
 */
BPMNProcessClient.prototype.setLogAppender = function setLogAppender(logAppender) {
  this._getImplementation().setLogAppender(logAppender);
};

/**
 * If we have a persistency layer that requires db connections, they are closed.
 * @param {Function} done
 */

BPMNProcessClient.prototype.closeConnection = function closeConnection(done) {
  this._getImplementation().closeConnection(done);
};

/**
 * @return {Transaction}
 */
BPMNProcessClient.prototype.getTrx = function getTrx() {
  return this._getImplementation().getCurrentTrx();
};

/**
 *
 * @param {String} key
 * @param {String} value
 */
BPMNProcessClient.prototype.traceString = function traceString(key, value) {
  if (this._getImplementation().getCurrentTrx()) {
    this._getImplementation().getCurrentTrx().processValueString(
      this._getImplementation().getProcessDefinition().name,
      this._getImplementation().getProcessId(),
      key,
      value.toString());
  }
};

/**
 *
 * @param {String} key
 * @param {Number} value
 */
BPMNProcessClient.prototype.traceFloat = function traceFloat(key, value) {
  var numValue = Number(value);
  if (!numValue) {
    numValue = 0;
  }

  if (this._getImplementation().getCurrentTrx()) {
    this._getImplementation().getCurrentTrx().processValueFloat(
      this._getImplementation().getProcessDefinition().name,
      this._getImplementation().getProcessId(),
      key,
      numValue);
  }
};

/**
 *
 * @param {String} key
 * @param {Date|Number} value
 */
BPMNProcessClient.prototype.traceDatetime = function traceDatetime(key, value) {
  var numValue = Number(value);
  if (!numValue) {
    numValue = 0;
  }

  numValue = new Date(numValue);

  if (this._getImplementation().getCurrentTrx()) {
    this._getImplementation().getCurrentTrx().processValueDateTime(
      this._getImplementation().getProcessDefinition().name,
      this._getImplementation().getProcessId(),
      key,
      numValue);
  }
};
