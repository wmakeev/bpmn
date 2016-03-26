/**
 * Copyright: E2E Technologies Ltd
 */

'use strict';

var util = require('util');
var async = require('async');

var _s = require('underscore.string');
// var definitions = require('./parsing/definitions.js');
var handlerTools = require('./handler.js');
var log = require('./logger.js');

var EventEmitter = require('events').EventEmitter;
var BPMNProcessState = require('./state.js').BPMNProcessState;
var BPMNProcessHistory = require('./history.js').BPMNProcessHistory;
var BPMNProcessClient = require('./client.js').BPMNProcessClient;
var BPMNPendingTimerEvents = require('./timeouts.js').BPMNPendingTimerEvents;

var activityEndHandlerPostfix = require('./parsing/activity.js').activityEndHandlerPostfix;

var TOKEN_ARRIVED_EVENT = 'TOKEN_ARRIVED_EVENT';
var ACTIVITY_END_EVENT = 'ACTIVITY_END_EVENT';
var INTERMEDIATE_CATCH_EVENT = 'INTERMEDIATE_CATCH_EVENT';
var BOUNDARY_CATCH_EVENT = 'BOUNDARY_CATCH_EVENT';

var transactionLog = null;
try {
  transactionLog = require('e2e-transaction-logger');
} catch (err) {
  transactionLog = null;
}

/**
 * @param {{toString, stack}} error
 */
function logDefaultedErrors(error) {
  /* eslint no-console: 0 */
  console.log("Unhandled error: '" + error + "' Stack trace: " + error.stack);
}


/**
 * @param {String} id
 * @param {BPMNProcessDefinition} processDefinition
 * @param {Object} eventHandler This object should contain event handler for all BPMN events
 * @param {Persistency=} persistency
 * @param {BPMNProcess=} parentProcess
 * @param {Token=} parentToken
 * @param {HistoryEntry=} parentHistoryEntry
 * @constructor
 */
function BPMNProcess(id, processDefinition, eventHandler, persistency, parentProcess, parentToken,
                     parentHistoryEntry) {
  /* eslint no-param-reassign: 0 */
  var self = this;
  var defaultErrorHandler;

  this.processId = id;
  this.processDefinition = processDefinition;
  this.eventHandler = eventHandler;
  this.parentProcess = parentProcess;
  this.pendingTimerEvents = new BPMNPendingTimerEvents(this);
  this.persistency = persistency;
  this.deferredEvents = [];
  this.deferEvents = false; // events must be deferred if the process engine is loading
                            // or saving state
  this.processClient = new BPMNProcessClient(this);
  this.participants = {};   // if the process takes part in a collaboration,
                            // we store all participant process in this map
  this.properties = {};     // TODO: how do we handle parent data?
  this.calledProcesses = {};
  this.logger = new log.Logger(this, { logLevel: log.logLevels.error });
  if (transactionLog) {
    this.transactionLogger = new transactionLog.TransactionLogger();
  }
  this.currentTrx = null;
  this.views = {
    startEvent: null,
    endEvent: null,
    duration: null
  };

  if (parentToken) {
    this.state = new BPMNProcessState(parentToken.substate);
    parentToken.substate = this.state;
    this.parentToken = parentToken;
  } else {
    this.state = new BPMNProcessState();
  }

  if (parentHistoryEntry) {
    this.history = new BPMNProcessHistory(parentHistoryEntry.subhistory);
    parentHistoryEntry.subhistory = this.history;
  } else {
    this.history = new BPMNProcessHistory();
  }

  defaultErrorHandler = logDefaultedErrors;
  function defaultEventHandler() {
    var done = arguments[arguments.length - 1];
    if (done) {
      done.call(self.processClient);
    }
  }

  eventHandler = eventHandler || {};
  this.defaultEventHandler = eventHandler.defaultEventHandler || defaultEventHandler;
  this.defaultErrorHandler = eventHandler.defaultErrorHandler || defaultErrorHandler;
  this.doneSavingHandler = eventHandler.doneSavingHandler;
  this.doneLoadingHandler = eventHandler.doneLoadingHandler;
  this.onBeginHandler = eventHandler.onBeginHandler;
  this.onEndHandler = eventHandler.onEndHandler;

  this._registerOnTokenArrivedEvent();
  this._registerActivityEndEvents();
  this._registerThrowIntermediateEvents();
  this._registerThrowBoundaryEvents();
}
util.inherits(BPMNProcess, EventEmitter);

/**
 * Internal creation. The process is created and try to load persisted data.
 * @param {String} id
 * @param {BPMNProcessDefinition} processDefinition
 * @param {Object} eventHandler This object should contain event handler for all BPMN events
 * @param {Persistency=} persistency
 * @param {BPMNProcess=} parentProcess
 * @param {Token=} parentToken
 * @param {HistoryEntry=} parentHistoryEntry
 * @param {Function=} callback
 * @return {BPMNProcess}
 */
function createBPMNProcess(id, processDefinition, eventHandler, persistency, parentProcess,
                           parentToken, parentHistoryEntry, callback) {
  /* eslint no-param-reassign: 0 */
  var bpmnProcess;

  if (typeof persistency === 'function') {
    callback = persistency;
    persistency = null;
    parentProcess = null;
    parentToken = null;
    parentHistoryEntry = null;
  } else if (typeof parentProcess === 'function') {
    callback = parentProcess;
    parentProcess = null;
    parentToken = null;
    parentHistoryEntry = null;
  } else if (typeof parentToken === 'function') {
    callback = parentToken;
    parentToken = null;
    parentHistoryEntry = null;
  } else if (typeof parentHistoryEntry === 'function') {
    callback = parentHistoryEntry;
    parentHistoryEntry = null;
  }

  if (!callback) {
    return;
  }

  bpmnProcess = new BPMNProcess(id, processDefinition, eventHandler, persistency, parentProcess,
    parentToken, parentHistoryEntry);

  if (bpmnProcess.isMainProcess()) {
    // we save all process information - including called processes - in one document
    bpmnProcess.loadPersistedData(function loadPersistedDataHandler(err) {
      if (callback) {
        callback(err, bpmnProcess);
      }
    });
  } else {
    if (callback) {
      process.nextTick(function nextTickHandler() {        // to stay consistent
        callback(null, bpmnProcess);
      });
    }
  }
}
exports.createBPMNProcess = createBPMNProcess;

/**
 * @returns {Boolean}
 */
BPMNProcess.prototype.isMainProcess = function isMainProcess() {
  return (this.parentProcess === undefined || this.parentProcess === null);
};

/**
 * @returns {BPMNProcessDefinition}
 */
BPMNProcess.prototype.getProcessDefinition = function getProcessDefinition() {
  return this.processDefinition;
};

/**
 * @returns {String}
 */
BPMNProcess.prototype.getProcessId = function getProcessId() {
  return this.processId;
};

/**
 * @param {Logger} logger
 */
BPMNProcess.prototype.setLogger = function setLogger(logger) {
  this.logger = logger;
};

/**
 * @param {number | string} logLevel
 */
BPMNProcess.prototype.setLogLevel = function setLogLevel(logLevel) {
  this.logger.setLogLevel(logLevel);
};

/**
 * @param {function(string)} logAppender
 */
BPMNProcess.prototype.setLogAppender = function setLogAppender(logAppender) {
  this.logger.logAppender = logAppender;
};

/**
 * Add winston log transport (semantic like winston add() [https://github.com/flatiron/winston])
 * @param winstonTransport
 * @param options
 */
BPMNProcess.prototype.addLogTransport = function addLogTransport(winstonTransport, options) {
  this.logger.addTransport(winstonTransport, options);
};

/**
 * Remove winston log transport (semantic like winston remove() [https://github.com/flatiron/winston])
 * @param winstonTransport
 */
BPMNProcess.prototype.removeLogTransport = function removeLogTransport(winstonTransport) {
  this.logger.removeTransport(winstonTransport);
};

/**
 * @returns {Transaction}
 */
BPMNProcess.prototype.getCurrentTrx = function getCurrentTrx() {
  return this.currentTrx;
};

/**
 * @param {String} eventName
 * @param {Object=} data
 */
BPMNProcess.prototype.triggerEvent = function triggerEvent(eventName, data) {
  var self = this;
  var processDefinition = self.processDefinition;
  var flowObjectName = eventName;
  var flowObject = processDefinition.getFlowObjectByName(flowObjectName);
  var taskDoneMatch = _s.endsWith(eventName, activityEndHandlerPostfix);

  if (flowObject) {
    this.logger.trace('Trigger ' + flowObject.type + ' "' + flowObject.name + '"', data);

    if (flowObject.isStartEvent) {
      if (self.history.hasBeenVisited(eventName)) {
        throw new Error('The start event "' + eventName +
          '" cannot start an already started process.');
      } else {
        // start events create a token and put it on the first occurrence
        self._putTokenAt(flowObject, data);
      }
    } else if (flowObject.isIntermediateCatchEvent) {
      process.nextTick(function nextTickHandler() {
        // We need this to achieve parallel collaborating processes
        // TODO: however, it is not completely clear to me whether this works in all circumstances
        self._emitEvent(INTERMEDIATE_CATCH_EVENT, eventName, data);
      });
    } else if (flowObject.isBoundaryEvent) {
      self._emitEvent(BOUNDARY_CATCH_EVENT, eventName, data);
    } else {
      throw new Error('The process "' + processDefinition.name +
        '" has no intermediate catch event for "' + eventName + '"');
    }
  } else if (taskDoneMatch) {
    flowObjectName = _s.strLeft(eventName, activityEndHandlerPostfix);
    flowObject = processDefinition.getFlowObjectByName(flowObjectName);

    if (flowObject && flowObject.isWaitTask) {
      self.taskDone(flowObjectName, data);
    } else {
      throw new Error('The process "' + processDefinition.name +
        '" does not know the event \'' + eventName + '"');
    }
  } else {
    throw new Error('The process "' + processDefinition.name +
      '" does not know the event \'' + eventName + '"');
  }
};

/**
 * Send a message by name to this process or along a message flow
 * @param {BPMNMessageFlow | String} messageFlow
 * @param {Object=} data
 */
BPMNProcess.prototype.sendMessage = function sendMessage(messageFlow, data) {
  var self = this;

  if (typeof messageFlow === 'string') {
    this.triggerEvent(messageFlow, data);
  } else {
    if (messageFlow.targetProcessDefinitionId) {
      this.getParticipantById(messageFlow.targetProcessDefinitionId,
        function getParticipantByIdHandler(err, partnerProcess) {
          var targetFlowObject =
                partnerProcess.processDefinition.getFlowObject(messageFlow.targetRef);
          var sourceFlowObject = self.processDefinition.getSourceFlowObject(messageFlow);

          self.logger.trace("Sending '" +
            messageFlow.name + "' from '" +
            sourceFlowObject.name + "' to '" +
            targetFlowObject.name + "'.", data);

          partnerProcess.triggerEvent(targetFlowObject.name, data);
        });
    } else {
      throw new Error('sendMessage: the "' + messageFlow.name +
        '" has no targetProcessDefinitionId. Is the message flow target an executable pool?');
    }
  }
};

/**
 * @param {String} taskName
 * @param {Object} data
 */
BPMNProcess.prototype.taskDone = function taskDone(taskName, data) {
  this.logger.trace('Task "' + taskName + '" done.', data);
  this.emitActivityEndEvent(taskName, data);
};

/**
 * @param {String} participantName
 * @param {Function} callback
 * @return {BPMNProcess}
 */
BPMNProcess.prototype.getParticipantByName = function getParticipantByName(participantName,
                                                                           callback) {
  callback(null, this.participants[participantName]);
};

/**
 * @param {String} processDefinitionId
 * @param {Function} callback
 * @return {BPMNProcess}
 */
BPMNProcess.prototype.getParticipantById = function getParticipantById(processDefinitionId,
                                                                       callback) {
  var participant = this.processDefinition.getParticipantById(processDefinitionId);
  callback(null, this.participants[participant.name]);
};

/**
 * @param {String} participantName
 * @param {BPMNProcess} bpmnProcess
 */
BPMNProcess.prototype.addParticipant = function addParticipant(participantName, bpmnProcess) {
  this.participants[participantName] = bpmnProcess;
};

/**
 * @return {BPMNProcess}
 */
BPMNProcess.prototype.getParentProcess = function getParentProcess() {
  return this.parentProcess;
};

/**
 * @param {BPMNFlowObject} currentFlowObject
 * @param {Object=} data
 */
BPMNProcess.prototype._putTokenAt = function _putTokenAt(currentFlowObject, data) {
  var self = this;
  var name = currentFlowObject.name;

  self.state.createTokenAt(name, self.processId);
  self.logger.debug('Token was put on "' + name + '"', data);
  self.onFlowObjectBegin(currentFlowObject, data, function onFlowObjectBeginHandler() {
    self._emitEvent(TOKEN_ARRIVED_EVENT, name, data);
  });
};

/**
 * @param {String} currentFlowObjectName
 * @param {Function} done
 */
BPMNProcess.prototype._notifyBPMNEditor = function _notifyBPMNEditor(currentFlowObjectName, done) {
  var self = this;
  var debuggerInterface = self.processDefinition.debuggerInterface;
  var flowObject = self.processDefinition.getFlowObjectByName(currentFlowObjectName);
  if (debuggerInterface && flowObject) {
    debuggerInterface.sendPosition(flowObject, self.logger, done);
  } else {
    done();
  }
};

/**
 * @param {Function} done
 * @private
 */
BPMNProcess.prototype._clearBPMNEditorState = function _clearBPMNEditorState(done) {
  var self = this;
  var debuggerInterface = self.processDefinition.debuggerInterface;
  if (debuggerInterface) {
    debuggerInterface.sendPosition({}, self.logger, done);
  } else {
    done();
  }
};


/**
 * @param {Function} callback
 */
BPMNProcess.prototype.onTokenArrivedEvent = function onTokenArrivedEvent(callback) {
  this.on(TOKEN_ARRIVED_EVENT, callback);
};

/**
 * @return {BPMNProcessState}
 */
BPMNProcess.prototype.getState = function getState() {
  return this.state;
};

/**
 * @return {BPMNProcessHistory}
 */
BPMNProcess.prototype.getHistory = function getHistory() {
  return this.history;
};

/**
 * @return {*}
 */
BPMNProcess.prototype.getProperties = function getProperties() {
  return this.properties;
};

/**
 * @param {Boolean=} closeConnection
 */
BPMNProcess.prototype.persist = function persist(closeConnection) {
  var mainProcess;
  var persistentData;
  var persistency = this.persistency;

  mainProcess = this.getMainProcess();
  function doneSaving(error, savedData) {
    if (error) {
      mainProcess.logger.error("Cannot persist process '" + mainProcess.processId +
        "'. Process name: '" + mainProcess.processDefinition.name + "'. Error: " + error);

      if (mainProcess.doneSavingHandler) {
        mainProcess.doneSavingHandler.call(mainProcess.processClient, error);
      }
    } else {
      if (mainProcess.doneSavingHandler) {
        mainProcess.doneSavingHandler.call(mainProcess.processClient, null, savedData);
      }

      mainProcess.logger.debug('SavedData: ', savedData);

      if (closeConnection) {
        persistency.close(function closeConnectionHandler() {
          mainProcess._emitDeferredEvents();
        });
      } else {
        mainProcess._emitDeferredEvents();
      }
    }
  }

  if (persistency) {
    this.setDeferEvents(true);
    persistentData = {
      processName: mainProcess.processDefinition.name,
      processId: mainProcess.processId,
      parentToken: mainProcess.parentToken || null,
      properties: mainProcess.properties,
      state: mainProcess.state,
      history: mainProcess.history,
      pendingTimeouts: mainProcess.pendingTimerEvents.pendingTimeouts,
      views: mainProcess.views
    };
    persistency.persist(persistentData, doneSaving);
  }
};

/**
 * If we have a persistency layer that requires db connections, they are closed.
 * @param {Function} done
 */
BPMNProcess.prototype.closeConnection = function closeConnection(done) {
  var persistency = this.persistency;
  if (persistency) {
    persistency.close(done);
  }
};

/**
 * @returns {BPMNProcess}
 */
BPMNProcess.prototype.getMainProcess = function getMainProcess() {
  var mainProcess;
  if (this.parentProcess) {
    mainProcess = this.parentProcess.getMainProcess();
  } else {
    mainProcess = this;
  }
  return mainProcess;
};

/**
 * @returns {Boolean}
 */
BPMNProcess.prototype.hasToDeferEvents = function hasToDeferEvents() {
  var mainProcess = this.getMainProcess();
  return mainProcess.deferEvents;
};

/**
 * @param {Boolean} deferEvents
 */
BPMNProcess.prototype.setDeferEvents = function setDeferEvents(deferEvents) {
  var mainProcess = this.getMainProcess();
  mainProcess.deferEvents = deferEvents;
};

/**
 * @param {Function} callback
 */
BPMNProcess.prototype.loadPersistedData = function loadPersistedData(callback) {
  var mainProcess;
  var processId;
  var processName;
  var cb = callback;

  if (typeof cb !== 'function') {
    cb = function noop() {
    };
  }

  mainProcess = this.getMainProcess();
  processId = mainProcess.processId;
  processName = mainProcess.processDefinition.name;

  function doneLoading(loadingError, loadedData) {
    if (loadingError) {
      mainProcess.logger.error("Cannot load process '" + mainProcess.processId +
        "'. Process name: '" + processName + "'. Error: " + loadingError);
      if (mainProcess.doneLoadingHandler) {
        mainProcess.doneLoadingHandler.call(mainProcess.processClient, loadingError, loadedData);
      }
      cb(loadingError, loadedData);
    } else {
      if (loadedData) {
        try {
          mainProcess.setPersistedData(loadedData);
        } catch (setPersistedDataError) {
          mainProcess.logger.error("Cannot load process '" + mainProcess.processId +
            "'. Process name: '" + processName + "'. Error: " + setPersistedDataError);
          if (mainProcess.doneLoadingHandler) {
            mainProcess.doneLoadingHandler
              .call(mainProcess.processClient, setPersistedDataError, loadedData);
          }
          return cb(setPersistedDataError, loadedData);
        }

        mainProcess.createCalledProcesses(
          function createCalledProcessesHandler(createCalledProcessesError) {
            if (createCalledProcessesError) {
              mainProcess.logger.error("Cannot load process '" + mainProcess.processId +
                "'. Process name: '" + processName + "'. Error: " + createCalledProcessesError);
              if (mainProcess.doneLoadingHandler) {
                mainProcess.doneLoadingHandler
                  .call(mainProcess.processClient, createCalledProcessesError, loadedData);
              }
              return cb(createCalledProcessesError, loadedData);
            }

            if (mainProcess.doneLoadingHandler) {
              mainProcess.doneLoadingHandler.call(mainProcess.processClient, null, loadedData);
            }

            mainProcess._emitDeferredEvents();
            return cb(null, loadedData);
          });
      } else {
        mainProcess._emitDeferredEvents();
        cb(null, loadedData);
      }
    }
    return void 0;
  }

  mainProcess.persistency.load(processId, processName, doneLoading);

  if (this.persistency) {
    this.setDeferEvents(true);
  } else {
    process.nextTick(function nextTickHandler() {          // to stay consistent
      cb();
    });
  }
};

/**
 * @param {Function} callback
 */
BPMNProcess.prototype.createCalledProcesses = function createCalledProcesses(callback) {
  var self = this;
  var cb = callback;
  var callActivityTokens = self.state.findCallActivityTokens();

  if (typeof cb !== 'function') {
    cb = function noop() {
    };
  }

  async.each(callActivityTokens, function asyncIter(callActivityToken, done) {
    var callActivityName = callActivityToken.position;
    var callActivity = self.processDefinition.getFlowObjectByName(callActivityName);
    callActivity.createCalledProcess(callActivityToken, self, createBPMNProcess,
      function createCalledProcessHandler(err, calledProcess) {
        if (err) {
          done(err);
        }
        calledProcess.createCalledProcesses(done);
      });
  }, cb);
};

BPMNProcess.prototype.setPersistedData = function setPersistedData(loadedData) {
  this.state = new BPMNProcessState(loadedData.state);
  this.history = new BPMNProcessHistory(loadedData.history);
  this.pendingTimerEvents = new BPMNPendingTimerEvents(this);
  this.pendingTimerEvents.restoreTimerEvents(loadedData.pendingTimeouts);
  this.properties = loadedData.properties || {};
};

/**
 * @param {String} name
 * @param {Object} value
 */
BPMNProcess.prototype.setProperty = function setProperty(name, value) {
  this.properties[name] = value;
};

/**
 * @param {String} name
 * @return {Object}
 */
BPMNProcess.prototype.getProperty = function getProperty(name) {
  return this.properties[name];
};

/**
 * @param {BPMNFlowObject} currentFlowObject
 * @param {Object} data
 * @param {Boolean=} returningFromCalledProcess
 * @private
 */
BPMNProcess.prototype._emitTokens = function _emitTokens(currentFlowObject, data,
                                                         returningFromCalledProcess) {
  var activity;
  var self = this;

  self.state.removeTokenAt(currentFlowObject);

  if (currentFlowObject.isBoundaryEvent) {
    activity = self.processDefinition.getFlowObject(currentFlowObject.attachedToRef);
    self._clearBoundaryTimerEvents(activity);
    self.state.removeTokenAt(activity);
    self.onFlowObjectEnd(activity.name);
  } else {
    self._clearBoundaryTimerEvents(currentFlowObject);
  }

  if (currentFlowObject.isCallActivity || currentFlowObject.isSubProcess) {
    currentFlowObject.emitTokens(self, data, createBPMNProcess, returningFromCalledProcess);
  } else {
    currentFlowObject.emitTokens(self, data);
  }
};

/**
 * @param {String} eventName
 * @param {Object} data
 */
BPMNProcess.prototype.emitActivityEndEvent = function emitActivityEndEvent(eventName, data) {
  this._emitEvent(ACTIVITY_END_EVENT, eventName, data);
};

/**
 * @param {BPMNFlowObject} currentFlowObject
 * @param {BPMNSequenceFlow} outgoingSequenceFlow
 * @param {Object} data
 */
BPMNProcess.prototype.emitTokenAlong = function emitTokenAlong(currentFlowObject,
                                                               outgoingSequenceFlow, data) {
  var nextFlowObject = this.processDefinition.getProcessElement(outgoingSequenceFlow.targetRef);
  this._putTokenAt(nextFlowObject, data);
};

/**
 * @returns {Boolean}
 */
BPMNProcess.prototype.isDebuggerEnabled = function isDebuggerEnabled() {
  var debuggerInterface = this.processDefinition.debuggerInterface;
  return (debuggerInterface && debuggerInterface.isInDebugger());
};

/**
 * Called on begin of activities, task, catch events, etc.
 * @param {BPMNFlowObject} currentFlowObject
 * @param {Object} data
 * @param {Function} done
 * @private
 */
BPMNProcess.prototype.onFlowObjectBegin = function onFlowObjectBegin(currentFlowObject,
                                                                     data, done) {
  var self = this;
  var name = currentFlowObject.name;

  function finished() {
    if (self.onBeginHandler) {
      self.onBeginHandler.call(self.processClient, name, data, function handler() {
        done();
      });
    } else {
      done();
    }
  }

  self.history.addEntry(currentFlowObject);

  if (currentFlowObject.isStartEvent) {
    self.views.startEvent = self.history.historyEntries[0];
  }

  if (self.isDebuggerEnabled()) {
    this._notifyBPMNEditor(name, finished);
  } else {
    finished();
  }
};

/**
 * Called on end of activities, task, catch events, etc.
 * @param {String} currentFlowObjectName
 * @param {Object=} data
 * @param {Function=} done
 */
BPMNProcess.prototype.onFlowObjectEnd = function onFlowObjectEnd(currentFlowObjectName,
                                                                 data, done) {
  var self = this;
  var history = self.history;

  function finished() {
    history.setEnd(currentFlowObjectName);
    if (history.isFinished()) {
      self.views.duration = history.finishedAt - history.createdAt;
    }

    // NOTE: done() MUST be called AFTER setEnd() because in done() the token is send
    // to the next flowObjects
    if (done) {
      done();
    }
  }

  if (self.onEndHandler) {
    self.onEndHandler.call(self.processClient, currentFlowObjectName, data, finished);
  } else {
    finished();
  }
};

/**
 * Called on end of processes (also called processes)
 * @param {String} endEventName
 * @param {Boolean=} isMainProcess
 * @param {Function=} done
 */
BPMNProcess.prototype.onProcessEnd = function onProcessEnd(endEventName, isMainProcess, done) {
  var self = this;
  var history = self.getHistory();

  function finished() {
    if (done) {
      done();
    }
    if (isMainProcess) {
      self.views.endEvent = history.getLastEntry(endEventName);
      // no parent implies we finish the main process
      // TODO: need a way to tell the outside in order to delete the object.
      // emit event ?
      // pass the manager to the process ?
      // pass a function that will be called here ?
      self.persist(true);
    }
  }

  if (self.isDebuggerEnabled()) {
    self._clearBPMNEditorState(finished);
  } else {
    finished();
  }
};

/**
 * @param {BPMNProcess} calledProcess
 */
BPMNProcess.prototype.registerCalledProcess = function registerCalledProcess(calledProcess) {
  var calledProcessId = calledProcess.processId;
  this.calledProcesses[calledProcessId] = calledProcess;
};

/**
 * @param {String} calledProcessId
 */
BPMNProcess.prototype.unregisterCalledProcess = function unregisterCalledProcess(calledProcessId) {
  delete this.calledProcesses[calledProcessId];
};

/**
 * @param {BPMNActivity} currentActivity
 * @private
 */
BPMNProcess.prototype._registerBoundaryTimerEvents =
  function _registerBoundaryTimerEvents(currentActivity) {
    var self = this;
    var boundaryEvents = this.processDefinition.getBoundaryEventsAt(currentActivity);

    boundaryEvents.forEach(function iter(boundaryEvent) {
      if (boundaryEvent.isTimerEvent) {
        self.pendingTimerEvents.addBoundaryTimerEvent(boundaryEvent);
      }
    });
  };

/**
 * @param {BPMNIntermediateCatchEvent} timerEvent
 * @private
 */
BPMNProcess.prototype._registerIntermediateTimerEvents =
  function _registerIntermediateTimerEvents(timerEvent) {
    this.pendingTimerEvents.addIntermediateTimerEvent(timerEvent);
  };

/**
 * @param {BPMNFlowObject} currentFlowObject
 * @private
 */
BPMNProcess.prototype._clearBoundaryTimerEvents =
  function _clearBoundaryTimerEvents(currentFlowObject) {
    var self = this;
    var boundaryEvents = this.processDefinition.getBoundaryEventsAt(currentFlowObject);

    boundaryEvents.forEach(function iter(boundaryEvent) {
      if (boundaryEvent.isTimerEvent) {
        self.pendingTimerEvents.removeTimeout(boundaryEvent.name);
      }
    });
  };

/**
 * @private
 */
BPMNProcess.prototype._registerActivityEndEvents = function _registerActivityEndEvents() {
  var self = this;

  self.on(ACTIVITY_END_EVENT, function activityEndHandler(activityName, activityEventData) {
    var currentToken;
    var owningProcessId;
    var currentProcess;
    var currentFlowObject;
    var handlerName = handlerTools.mapName2HandlerName(activityName) + activityEndHandlerPostfix;
    var trx = self.currentTrx = null;

    if (self.transactionLogger) {
      trx = self.currentTrx = self.transactionLogger
        .startTransaction(self.processDefinition.name, 'PSTATE', 'TRANSITION', null,
          activityName + 'Done');
    }

    if (self.state.hasTokens(activityName)) {
      currentToken = self.state.getFirstToken(activityName);
      owningProcessId = currentToken.owningProcessId;
      currentProcess = owningProcessId === self.processId
        ? self : self.calledProcesses[owningProcessId];
      currentFlowObject = currentProcess.processDefinition
        .getFlowObjectByName(currentToken.position);

      self.logger.trace('Calling "' + handlerName + '" for ' + ACTIVITY_END_EVENT + ' "' +
        activityName + '".');

      handlerTools.callHandler(handlerName, currentProcess, activityEventData,
        function activityEndHandlerIsDone(data) {
          if (trx) {
            trx.processStateEnd(self.processDefinition.name, self.getProcessId(), activityName);
            trx.end();
          }
          self.logger.trace("Calling done() of '" + handlerName + "'.");
          currentProcess._emitTokens(currentFlowObject, data, true);
        });
    } else {
      self.callDefaultEventHandler(ACTIVITY_END_EVENT, activityName, handlerName,
        'Process cannot handle this activity because it is not currently executed.',
        function handler() {
          if (trx) {
            trx.end();
          }
        });
    }
  });
};

/**
 * @private
 */
BPMNProcess.prototype._registerThrowIntermediateEvents =
  function _registerThrowIntermediateEvents() {
    var self = this;

    self.on(INTERMEDIATE_CATCH_EVENT, function onHandler(eventName, eventData) {
      var catchIntermediateEventObject;
      var handlerName = handlerTools.mapName2HandlerName(eventName);
      var trx = self.currentTrx = null;

      if (self.transactionLogger) {
        trx = self.currentTrx = self.transactionLogger
          .startTransaction(self.processDefinition.name, 'PSTATE', 'TRANSITION', null, eventName);
      }

      if (self.state.hasTokens(eventName)) {
        if (trx) {
          trx.processEvent(self.processDefinition.name, self.getProcessId(), eventName);
        }
        catchIntermediateEventObject = self.processDefinition.getFlowObjectByName(eventName);
        self.logger.trace("Calling '" + handlerName + "' for " + INTERMEDIATE_CATCH_EVENT + " '"
          + eventName + "'.");
        handlerTools.callHandler(handlerName, self, eventData, function eventCaughtHandler(data) {
          if (trx) {
            trx.end();
          }
          self.logger.trace('Calling done() of "' + handlerName + '".');
          self._emitTokens(catchIntermediateEventObject, data, true);
        });
      } else {
        self.callDefaultEventHandler(INTERMEDIATE_CATCH_EVENT, eventName, handlerName,
          'Process cannot handle the intermediate event " + ' +
          eventName + '" because the process "' + self.processDefinition.name +
          '" doesn\'t expect one.',
          function handler() {
            if (trx) {
              trx.end();
            }
          });
      }
    });
  };

/**
 * @private
 */
BPMNProcess.prototype._registerThrowBoundaryEvents = function _registerThrowBoundaryEvents() {
  var self = this;

  self.on(BOUNDARY_CATCH_EVENT, function onHandler(eventName, eventData) {
    var handlerName = handlerTools.mapName2HandlerName(eventName);
    var catchBoundaryEventObject = self.processDefinition.getFlowObjectByName(eventName);
    var activity = self.processDefinition.getFlowObject(catchBoundaryEventObject.attachedToRef);
    var trx = self.currentTrx = null;

    if (self.transactionLogger) {
      trx = self.currentTrx = self.transactionLogger.startTransaction(self.processDefinition.name,
        'PSTATE', 'TRANSITION', null, eventName);
    }

    self.logger.trace('Catching boundary event "' + eventName + '" done.', eventData);

    if (self.state.hasTokensAt(activity)) {
      if (trx) {
        trx.processStateEnd(self.processDefinition.name, self.getProcessId(), activity.name);
      }
      self.state.removeTokenAt(activity);
      self._putTokenAt(catchBoundaryEventObject, eventData);
    } else {
      self.callDefaultEventHandler(BOUNDARY_CATCH_EVENT, eventName, handlerName,
        'Process cannot handle the boundary event "' +
        eventName + '" because the activity "' + activity.name + '" doesn\'t expect one.',
        function handler() {
          if (trx) {
            trx.end();
          }
        });
    }
  });
};

/**
 * @private
 */
BPMNProcess.prototype._registerOnTokenArrivedEvent = function _registerOnTokenArrivedEvent() {
  var self = this;

  self.onTokenArrivedEvent(function onTokenArrivedEventHandler(currentFlowObjectName, eventData) {
    var currentFlowObject = self.processDefinition.getFlowObjectByName(currentFlowObjectName);
    var trx = self.currentTrx;

    self.logger.debug('Token arrived at ' + currentFlowObject.type + ' "' +
      currentFlowObject.name + '"', eventData);

    if (currentFlowObject.isIntermediateCatchEvent) {
      // all intermediate event handlers are called WHEN the event occurs
      // TODO: should we change this?
      if (currentFlowObject.isTimerEvent) {
        self._registerIntermediateTimerEvents(currentFlowObject);
      }
      self.persist();
    } else {
      if (currentFlowObject.isBoundaryEvent && trx) {
        if (trx) {
          trx.processEvent(self.processDefinition.name, self.getProcessId(),
            currentFlowObjectName);
        }
      } else {
        if (self.transactionLogger) {
          trx = self.currentTrx = self.transactionLogger
            .startTransaction(self.processDefinition.name, 'PSTATE', 'TRANSITION', null,
              currentFlowObjectName);

          if (currentFlowObject.isActivity) {
            trx.processStateStart(self.processDefinition.name, self.getProcessId(),
              currentFlowObjectName);
          } else if (currentFlowObject.isIntermediateThrowEvent) {
            trx.processEvent(self.processDefinition.name, self.getProcessId(),
              currentFlowObjectName);
          } else if (currentFlowObject.isStartEvent) {
            trx.processStart(self.processDefinition.name, self.getProcessId(),
              currentFlowObjectName);
          } else if (currentFlowObject.isEndEvent) {
            trx.processEnd(self.processDefinition.name, self.getProcessId(),
              currentFlowObjectName);
          }
        }
      }

      handlerTools.callHandler(currentFlowObjectName, self, eventData, function handlerDone(data) {
        if (currentFlowObject.isWaitTask) {
          if (trx) {
            trx.end();
          }
          self._registerBoundaryTimerEvents(currentFlowObject);
          self.persist();
        } else if (currentFlowObject.isCallActivity || currentFlowObject.isSubProcess) {
          if (trx) {
            trx.end();
          }
          self._registerBoundaryTimerEvents(currentFlowObject);
          self._emitTokens(currentFlowObject, data);
        } else if (currentFlowObject.isActivity) {
          if (trx) {
            trx.processStateEnd(self.processDefinition.name, self.getProcessId(),
              currentFlowObjectName);
            trx.end();
          }
          self._emitTokens(currentFlowObject, data);
        } else if (currentFlowObject.isExclusiveGateway) {
          self._emitTokens(currentFlowObject, data);
        } else {
          if (trx) {
            trx.end();
          }
          self._emitTokens(currentFlowObject, data);
        }
      });
    }
  });
};

/**
 * @param {String} eventType
 * @param {String} eventName
 * @param data
 * @private
 */
BPMNProcess.prototype._emitEvent = function _emitEvent(eventType, eventName, data) {
  data = data || {};
  if (this.hasToDeferEvents()) {
    this.deferredEvents.push({ type: eventType, name: eventName, data: data });
  } else {
    this.emit(eventType, eventName, data);
  }
};

/**
 * @private
 */
BPMNProcess.prototype._emitDeferredEvents = function _emitDeferredEvents() {
  var self = this;

  this.setDeferEvents(false); // we have to reset this flag, otherwise the deferred events
                              // we try to emit now would be deferred again!
  this.deferredEvents.forEach(function iter(event) {
    self.logger
      .trace('Emitting deferred events ' + event.type + ' "' + event.name + '"', event.data);
    process.nextTick(function nextTickHandler() {
      self.emit(event.type, event.name, event.data);
    });
  });
  this.deferredEvents = [];
};

/**
 * @param {String} eventType
 * @param {String?} currentFlowObjectName
 * @param {String} handlerName
 * @param {String} reason
 * @param {Function=} done
 */
BPMNProcess.prototype.callDefaultEventHandler =
  function callDefaultEventHandler(eventType, currentFlowObjectName, handlerName, reason, done) {
    this.logger.trace('Unhandled event: "' + eventType + "' for '" + currentFlowObjectName +
      '". Handler: ' + handlerName + '". Reason: ' + reason);
    this.defaultEventHandler
      .call(this.processClient, eventType, currentFlowObjectName, handlerName, reason, done);
  };
