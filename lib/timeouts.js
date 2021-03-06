/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var handler = require('./handler.js');
var getTimeoutHandlerPostfix = handler.handlerNameSeparator + 'getTimeout';

/**
 * @param {Number} timeoutInMs
 * @param {Boolean} isRelative
 * @constructor
 */
function Timeout(timeoutInMs, isRelative) {
  var at;
  var now;

  if (isRelative) {
    now = Date.now();
    at = now + timeoutInMs;
  } else {
    at = timeoutInMs;
  }

  this.at = at;
  this.timeout = timeoutInMs;
}

/**
 * @constructor
 */
function BPMNPendingTimerEvents(bpmnProcess) {
  /** @type {Array.<Timeout>} */
  this.pendingTimeouts = {};
  this.bpmnProcess = bpmnProcess;
  this.setTimeoutIds = {};
}
exports.BPMNPendingTimerEvents = BPMNPendingTimerEvents;

/**
 * @return {Boolean}
 */
BPMNPendingTimerEvents.prototype.hasTimeouts = function hasTimeouts() {
  return (Object.keys(this.pendingTimeouts).length > 0);
};

/**
 * @param {String} timerEventName
 * @return {Timeout}
 */
BPMNPendingTimerEvents.prototype.getTimeout = function getTimeout(timerEventName) {
  return this.pendingTimeouts[timerEventName];
};

/**
 * @param {String} timerEventName
 */
BPMNPendingTimerEvents.prototype.removeTimeout = function removeTimeout(timerEventName) {
  if (this.pendingTimeouts[timerEventName]) {
    delete this.pendingTimeouts[timerEventName];
  }

  if (this.setTimeoutIds[timerEventName]) {
    clearTimeout(this.setTimeoutIds[timerEventName]);
    delete this.setTimeoutIds[timerEventName];
  }
};

/**
 * @param {Object} pendingTimeouts Object that maps timeout event names to timeouts
 */
BPMNPendingTimerEvents.prototype.restoreTimerEvents = function restoreTimerEvents(pendingTimeouts) {
  var self = this;
  var processDefinition = this.bpmnProcess.processDefinition;

  if (pendingTimeouts) {
    Object.keys(pendingTimeouts).forEach(function keysIter(timerEventName) {
      var timerEvent = processDefinition.getFlowObjectByName(timerEventName);
      if (timerEvent.isIntermediateCatchEvent) {
        self.addIntermediateTimerEvent(timerEvent, pendingTimeouts[timerEventName]);
      } else {
        self.addBoundaryTimerEvent(timerEvent, pendingTimeouts[timerEventName]);
      }
    });
  }
};

/**
 * @param {BPMNBoundaryEvent} timerEvent
 * @param {Timeout=} pendingTimeout If given, this timeout object is added to the pending timeouts.
 *                                  If not given, a new timeout will be created.
 */
BPMNPendingTimerEvents.prototype.addBoundaryTimerEvent =
  function addBoundaryTimerEvent(timerEvent, pendingTimeout) {
    var bpmnProcess = this.bpmnProcess;
    var self = this;
    var timerEventName = timerEvent.name;
    this.addTimerEvent(timerEventName, pendingTimeout, function addTimerEventHandler() {
      bpmnProcess.logger.trace("Caught boundary timer event: '" + timerEvent.name + "'.");
      self.removeTimeout(timerEventName);
      bpmnProcess._putTokenAt(timerEvent);
    });
  };

/**
 * @param {BPMNIntermediateCatchEvent} timerEvent
 * @param {Timeout=} pendingTimeout If given, this object is added to the pending timeouts.
 *                                  If not given, a new timeout will be created.
 */
BPMNPendingTimerEvents.prototype.addIntermediateTimerEvent =
  function addIntermediateTimerEvent(timerEvent, pendingTimeout) {
    var bpmnProcess = this.bpmnProcess;
    var self = this;
    var timerEventName = timerEvent.name;
    this.addTimerEvent(timerEventName, pendingTimeout, function addTimerEventHandler() {
      var trx = bpmnProcess.currentTrx = null;

      if (bpmnProcess.transactionLogger) {
        trx = bpmnProcess.currentTrx = bpmnProcess.transactionLogger
          .startTransaction(bpmnProcess.processDefinition.name,
            'PSTATE', 'TRANSITION', null, timerEvent.name);
        trx.processEvent(bpmnProcess.processDefinition.name,
          bpmnProcess.getProcessId(), timerEvent.name);
      }

      bpmnProcess.logger.trace("Caught intermediate timer event: '" + timerEvent.name + "'.");
      bpmnProcess.state.removeTokenAt(timerEvent);
      self.removeTimeout(timerEventName);
      handler.callHandler(timerEventName, bpmnProcess, null, function handlerDone() {
        if (trx) {
          trx.end();
        }
        timerEvent.emitTokens(bpmnProcess);
      });
    });
  };

/**
 * @param {String} timerEventName
 * @param {Timeout=} pendingTimeout If given, this object is added to the pending timeouts.
 *                                  If not given, a new timeout will be created.
 * @param {Function=} timeoutEventHandler
 */
BPMNPendingTimerEvents.prototype.addTimerEvent = function addTimerEvent(timerEventName,
                                                                        pendingTimeout,
                                                                        timeoutEventHandler) {
  var bpmnProcess = this.bpmnProcess;
  var self = this;
  var getTimeoutHandlerName = timerEventName + getTimeoutHandlerPostfix;
  var timeoutInMs = handler.callHandler(getTimeoutHandlerName, bpmnProcess);
  var timeout;
  var now;
  var diff;

  if (isNaN(timeoutInMs)) {
    throw new Error('The getTimeout handler "' + getTimeoutHandlerName +
      '" does not return a number but "' + timeoutInMs + '"');
  } else {
    timeout = pendingTimeout || new Timeout(timeoutInMs, true);
    self.pendingTimeouts[timerEventName] = timeout;

    now = Date.now();
    diff = timeout.at - now;
    if (diff > 0) {
      bpmnProcess.logger.debug("Set timer for '" + timerEventName + "'. Timeout: " + diff);
      self.setTimeoutIds[timerEventName] = setTimeout(timeoutEventHandler, diff);
    } else {
      timeoutEventHandler();
    }
  }
};
